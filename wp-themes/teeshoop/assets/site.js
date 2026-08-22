/*
 * The whole script. Three behaviours, no framework, no dependency.
 *
 * EVERY ONE OF THEM IS AN ENHANCEMENT. With this file blocked the navigation is
 * a visible list, the filter panel is a visible form with a submit button, and
 * the long facets are simply long. Nothing on this site needs JavaScript to be
 * bought, which is not a purity argument: the studio is already a heavy page
 * and the surrounding site is not allowed to add to it.
 *
 * `has-js` is set inline in the document head so the stylesheet can collapse
 * the menu before it is painted. Without that the page would flash an open
 * navigation on every load.
 */
;(function () {
  'use strict'

  var doc = document

  /* --------------------------------------------------------------- menu -- */

  var burger = doc.querySelector('.ts-burger')
  var nav = doc.getElementById('ts-nav')

  if (burger && nav) {
    burger.hidden = false

    var setMenu = function (open) {
      nav.classList.toggle('is-open', open)
      burger.setAttribute('aria-expanded', open ? 'true' : 'false')
    }

    burger.addEventListener('click', function () {
      setMenu(burger.getAttribute('aria-expanded') !== 'true')
    })

    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || burger.getAttribute('aria-expanded') !== 'true') return
      setMenu(false)
      burger.focus()
    })

    /*
     * A click outside closes it. `composedPath` rather than `contains` so a
     * click that starts inside and ends outside does not count as outside.
     */
    doc.addEventListener('click', function (e) {
      if (burger.getAttribute('aria-expanded') !== 'true') return
      var path = e.composedPath ? e.composedPath() : [e.target]
      if (path.indexOf(nav) === -1 && path.indexOf(burger) === -1) setMenu(false)
    })
  }

  /* ------------------------------------------------------------ filters -- */

  var toggle = doc.querySelector('.ts-filters__toggle')
  var panel = doc.getElementById('ts-filters-body')

  if (toggle && panel) {
    /*
     * Open when something is already filtering, so a shared URL does not arrive
     * with its own criteria hidden behind a button. `body.ts-filtered` is set by
     * PHP, which is the only side that knows.
     */
    var filtered = doc.body.classList.contains('ts-filtered')
    panel.classList.toggle('is-open', filtered)
    toggle.setAttribute('aria-expanded', filtered ? 'true' : 'false')

    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') !== 'true'
      panel.classList.toggle('is-open', open)
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
    })
  }

  /* --------------------------------------------- searching inside a facet -- */

  /*
   * Two shapes of long facet. The plain ones (brands, sizes) are one list of
   * chips. The colour facet is eleven `<details>` groups, because four hundred
   * and forty-two manufacturer names cannot be one list and the brief forbids
   * merging them.
   *
   * A HIDDEN OPTION'S CHECKBOX IS NEVER DISABLED. A value the buyer selected
   * before typing must still be submitted, and a `<details>` that is shut still
   * has its checkboxes in the form.
   */
  var strip = function (s) {
    // Fold accents so "coton" finds "Côton" and "ecru" finds "Écru".
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  }

  var labelOf = function (li) {
    var label = li.querySelector('.ts-chip__label')
    return strip(label ? label.textContent : li.textContent)
  }

  Array.prototype.forEach.call(doc.querySelectorAll('[data-ts-facet-find]'), function (input) {
    var facet = input.closest('.ts-facet')
    if (!facet) return
    // The wrapper carries the label, so unhiding the input alone would leave a
    // screen reader announcing a control nobody can see.
    var shell = input.closest('[data-ts-facet-shell]') || input
    shell.hidden = false

    var groups = Array.prototype.slice.call(facet.querySelectorAll('.ts-fam__group'))

    if (!groups.length) {
      var list = facet.querySelector('.ts-facet__list')
      if (!list) return
      var items = Array.prototype.slice.call(list.children)
      input.addEventListener('input', function () {
        var q = strip(input.value.trim())
        items.forEach(function (li) {
          li.hidden = !(q === '' || labelOf(li).indexOf(q) !== -1)
        })
      })
      return
    }

    /*
     * The groups a shared URL arrived with open are reopened when the search
     * box is cleared. Without that, typing and then deleting would leave the
     * buyer's own selected colour folded away inside a shut group.
     */
    var was = groups.map(function (g) {
      return g.open
    })

    input.addEventListener('input', function () {
      var q = strip(input.value.trim())
      groups.forEach(function (group, i) {
        var items = Array.prototype.slice.call(group.querySelectorAll('.ts-fam__list > li'))
        var hits = 0
        items.forEach(function (li) {
          var hit = q === '' || labelOf(li).indexOf(q) !== -1
          li.hidden = !hit
          if (hit) hits++
        })
        /*
         * The header count is rendered server-side and says how many names the
         * family holds. While a query is narrowing the list underneath it, that
         * number describes something the buyer cannot see, so it says what is
         * left instead and is put back when the box is cleared.
         */
        var tally = group.querySelector('.ts-fam__n')
        if (tally && tally.dataset.tsFull === undefined) tally.dataset.tsFull = tally.textContent
        if (q === '') {
          group.hidden = false
          group.open = was[i]
          if (tally) tally.textContent = tally.dataset.tsFull
        } else {
          group.hidden = hits === 0
          group.open = hits > 0
          if (tally) tally.textContent = tally.dataset.tsFull.replace(/\d[\d\u202f\u00a0 ]*/, String(hits) + ' ')
        }
      })
    })
  })

})()
