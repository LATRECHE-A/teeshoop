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
   * The colour facet is several hundred terms long, and the brief forbids
   * merging "Navy", "French Navy" and "Deep Navy" into one, so it stays long.
   * This narrows the visible options as you type. The input is `hidden` in the
   * markup and revealed here, because without the script it would be a box that
   * does nothing.
   *
   * A hidden option's checkbox is NOT disabled: a value the buyer selected
   * before typing must still be submitted.
   */
  Array.prototype.forEach.call(doc.querySelectorAll('[data-ts-facet-find]'), function (input) {
    var list = input.closest('.ts-facet') && input.closest('.ts-facet').querySelector('.ts-facet__list')
    if (!list) return
    input.hidden = false

    var items = Array.prototype.slice.call(list.children)
    var strip = function (s) {
      // Fold accents so "coton" finds "Côton" and "ecru" finds "Écru".
      return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    }

    input.addEventListener('input', function () {
      var q = strip(input.value.trim())
      items.forEach(function (li) {
        var label = li.querySelector('.ts-chip__label')
        var hit = q === '' || strip(label ? label.textContent : li.textContent).indexOf(q) !== -1
        li.hidden = !hit
      })
    })
  })
})()
