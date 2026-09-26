/*
 * The whole script. Four behaviours, no framework, no dependency.
 *
 * EVERY ONE OF THEM IS AN ENHANCEMENT. With this file blocked the navigation is
 * a visible list, the filter panel is a visible form with a submit button, the
 * long facets are simply long, and the homepage's garment still changes colour
 * because the stylesheet does that part on its own. Nothing on this site needs
 * JavaScript to be bought, which is not a purity argument: the studio is
 * already a heavy page and the surrounding site is not allowed to add to it.
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

  /* ------------------------------------------------ the garment demo -- */

  /*
   * TWO JOBS, AND BOTH ARE ENHANCEMENTS.
   *
   * 1. THE FALLBACK PAINT. The colour follows the checked radio through
   *    `:has()` in the stylesheet, with no script at all. This sets the same
   *    custom property directly, which is what keeps the swatches working in a
   *    browser that has no `:has()`. Where both work, this simply writes the
   *    value the stylesheet already computed.
   *
   * 2. THE UNPROMPTED DEMONSTRATION. A visitor who never touches the swatches
   *    never learns that the garment comes in seventeen colours, which is the
   *    one thing this block exists to say. So it advances on its own, slowly,
   *    and stops for good the moment somebody takes over.
   *
   * IT STOPS FOR THREE REASONS, and every one of them is somebody saying no:
   * the visitor picked a colour, the visitor asked their system for less
   * motion, or the demonstration scrolled out of sight. The last one is not
   * politeness, it is a timer that would otherwise repaint a page nobody is
   * looking at for as long as the tab is open.
   */
  var demo = doc.querySelector('[data-teeshoop="demo-accueil"]')

  if (demo) {
    var stage = demo.querySelector('.ts-demo__stage')
    var radios = Array.prototype.slice.call(demo.querySelectorAll('.ts-demo__radio'))

    var paint = function () {
      var picked = demo.querySelector('.ts-demo__radio:checked')
      if (picked && stage && picked.dataset.tint) stage.style.setProperty('--ts-demo-tint', picked.dataset.tint)
    }

    if (radios.length > 0) {
      paint()
      radios.forEach(function (radio) {
        radio.addEventListener('change', paint)
      })

      /*
       * `matchMedia` and not a CSS-only guard: the stylesheet can refuse the
       * transition, and only the script can refuse to START one. A reduced
       * motion setting that still cycled the garment every 2,6 s would be the
       * setting ignored, just without the fade.
       */
      var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)')
      var timer = null
      /*
       * A DELIBERATE ACT ENDS IT FOR THE REST OF THE VISIT (THE-04). Pausing
       * was not enough: the observer below restarted the cycle when the garment
       * came back into view, and a visitor who had picked Navy, read on and
       * scrolled back found their choice gone.
       */
      var stopped = false

      var halt = function () {
        if (timer !== null) {
          window.clearInterval(timer)
          timer = null
        }
      }

      var advance = function () {
        var at = radios.indexOf(demo.querySelector('.ts-demo__radio:checked'))
        var next = radios[(at + 1) % radios.length]
        if (!next) return
        /*
         * `checked` and not `.click()`: a click would move the focus ring onto
         * a control the visitor never touched, and on a phone that scrolls the
         * page. Setting the property does not fire `change`, so the paint is
         * called by hand.
         */
        next.checked = true
        paint()
      }

      var stop = function () {
        stopped = true
        halt()
      }

      if (!(still && still.matches) && radios.length > 1) {
        // Any deliberate act ends it: a pointer on the swatches, or a keyboard.
        demo.addEventListener('pointerdown', stop)
        demo.addEventListener('keydown', stop)
        radios.forEach(function (radio) {
          radio.addEventListener('change', stop)
        })

        /*
         * AND IF THEY ASK FOR LESS MOTION WHILE THE PAGE IS OPEN, IT STOPS.
         *
         * The setting was read once, at load, which is right for deciding
         * whether to start and wrong for everything after: a visitor who turns
         * it on in their system preferences with this tab already open kept a
         * garment cycling every 2,6 s. It is a system-wide accessibility
         * setting, so honouring it only at load is honouring it by luck.
         */
        if (still && still.addEventListener) {
          still.addEventListener('change', function (e) {
            if (e.matches) stop()
          })
        }

        if (window.IntersectionObserver) {
          new window.IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting && timer === null && !stopped) timer = window.setInterval(advance, 2600)
              else if (!entry.isIntersecting) halt()
            })
          }).observe(demo)
        }
      }
    }
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
    /*
     * ENTER FILTERS THE LIST, IT DOES NOT SUBMIT THE PAGE (THE-13). The box sits
     * inside the filter form, so the key everyone presses in a search field
     * reloaded the listing, lost the text and gave back every colour.
     */
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') e.preventDefault()
    })

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

  /* -------------------------------------------------- modèles sauvegardés -- */

  /*
   * « Personnalisation » ouvre l'atelier avec le modèle choisi sur la page devis.
   * Sans ce script, le lien ouvre l'atelier sur une création vide, et le modèle
   * part quand même avec la demande : c'est le formulaire qui l'envoie.
   */
  var atelier = doc.querySelector('[data-ts-atelier]')
  var modele = doc.querySelector('[data-ts-modele]')

  if (atelier && modele) {
    var base = atelier.getAttribute('href')
    var suivre = function () {
      var u = new URL(base, location.href)
      if (modele.value) u.searchParams.set('modele', modele.value)
      atelier.setAttribute('href', u.toString())
    }
    modele.addEventListener('change', suivre)
    suivre()
  }

  /*
   * LA PASTILLE DU PANIER SUIT L'AJOUT (EDI-10). L'éditeur disait « Ajouté au
   * panier » pendant que l'en-tête gardait l'ancien nombre, ou aucun, jusqu'au
   * prochain chargement : de quoi douter de l'ajout et cliquer une seconde fois.
   * Le nombre est celui de la boutique (`get_cart_contents_count`, comme ici).
   */
  doc.body.addEventListener('teeshoop:added', function (e) {
    var n = Number(e.detail && e.detail.cart_count)
    var cart = doc.querySelector('.ts-mast__cart')
    if (!cart || !(n > 0)) return
    var badge = cart.querySelector('.ts-mast__cart-n')
    if (!badge) {
      badge = doc.createElement('span')
      badge.className = 'ts-mast__cart-n ts-num'
      cart.appendChild(badge)
    }
    badge.textContent = String(n)
  })

})()
