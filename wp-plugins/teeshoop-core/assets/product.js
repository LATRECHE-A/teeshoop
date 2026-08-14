/**
 * The product page's live estimate.
 *
 * THERE IS NO PRICE IN THIS FILE, and there must never be one. Every figure it
 * shows arrives from `GET /wp-json/teeshoop/v1/quote`, already formatted in
 * French by `Money::format` on the server. A quantity table in JavaScript would
 * be a second price engine, and two engines pricing the same shirt always
 * diverge in the end (a tier boundary, a rounding mode, a VAT basis), after which the page says one number and the invoice says another.
 *
 * It is an enhancement, not a requirement. Without JavaScript the same form
 * submits as a GET and WordPress renders the same estimate, computed by the
 * same `Pricing::quote`. This file's first act is to hide the submit button it
 * has just made redundant; a page that never runs it keeps a button that works.
 */
(function () {
	'use strict';

	var cfg = window.TEESHOOP_PRODUCT;
	if (!cfg || !cfg.restUrl) {
		return;
	}

	var box = document.querySelector('[data-teeshoop-buy]');
	var form = box && box.querySelector('[data-teeshoop-estimator]');
	var estimate = box && box.querySelector('[data-teeshoop-estimate]');
	if (!form || !estimate) {
		return;
	}

	var recalc = form.querySelector('[data-teeshoop-recalc]');
	var panes = {
		single: form.querySelector('[data-teeshoop-pane="single"]'),
		grid: form.querySelector('[data-teeshoop-pane="grid"]'),
	};
	var gridTotal = form.querySelector('[data-teeshoop-grid-total]');
	var out = {
		summary: estimate.querySelector('[data-teeshoop-for]'),
		totalHt: estimate.querySelector('[data-teeshoop-total-ht]'),
		totalTtc: estimate.querySelector('[data-teeshoop-total-ttc]'),
		unit: estimate.querySelector('[data-teeshoop-unit]'),
		discount: estimate.querySelector('[data-teeshoop-discount]'),
	};
	var needsQuote = box.querySelector('[data-teeshoop-needs-quote]');
	var personnaliser = box.querySelector('[data-teeshoop-personnaliser]');
	var devisLink = box.querySelector('[data-teeshoop-devis-link]');

	if (recalc) {
		recalc.hidden = true;
	}

	/** What the form currently says. Read, never remembered. */
	function readForm() {
		var mode = 'single';
		var modeInput = form.querySelector('[data-teeshoop-mode]:checked');
		if (modeInput) {
			mode = modeInput.value;
		}

		var faces = 1;
		var faceInput = form.querySelector('input[name="faces"]:checked');
		if (faceInput) {
			faces = parseInt(faceInput.value, 10) || 1;
		}

		var sizes = {};
		var total = 0;
		Array.prototype.forEach.call(form.querySelectorAll('[data-teeshoop-pane="grid"] input[name^="tailles"]'), function (input) {
			var match = /tailles\[([^\]]+)\]/.exec(input.name);
			var n = parseInt(input.value, 10);
			if (!match || !n || n < 1) {
				return;
			}
			sizes[match[1]] = n;
			total += n;
		});

		var typed;
		if (mode === 'grid') {
			typed = total;
		} else {
			var qtyInput = form.querySelector('input[name="qte"]');
			typed = qtyInput ? parseInt(qtyInput.value, 10) : 1;
		}
		if (!typed || typed < 1) {
			typed = 1;
		}

		// `typed` is what the buyer asked for and `qty` is what can be priced.
		// They are kept apart so the page can say "you asked for 30 000" instead
		// of quietly pricing 10 000, which is what the cart already refuses to do.
		var qty = cfg.maxQty && typed > cfg.maxQty ? cfg.maxQty : typed;

		var sizeInput = form.querySelector('select[name="taille"]');
		var size = sizeInput ? sizeInput.value : '';

		return {
			mode: mode,
			faces: faces,
			qty: qty,
			typed: typed,
			size: size,
			sizes: sizes,
			gridTotal: total,
		};
	}

	function showPanes(mode) {
		if (panes.single) {
			panes.single.hidden = mode !== 'single';
		}
		if (panes.grid) {
			panes.grid.hidden = mode !== 'grid';
		}
	}

	/**
	 * Carry the configuration into the editor.
	 *
	 * The size breakdown a buyer fills in here is the same one the studio's
	 * basket panel asks for. Retyping it there would be this page throwing away
	 * work the customer already did. It is a PRE-FILL and nothing more: the
	 * server re-derives the garment from the product and the printed areas from
	 * the stored design, so a hand-edited link changes what a form shows and
	 * never what an invoice says.
	 */
	function updateStudioLink(state) {
		if (!personnaliser) {
			return;
		}
		var url = new URL(personnaliser.href, window.location.href);
		var params = url.searchParams;

		/*
		 * `Array.from`, NOT `Array.prototype.slice.call`.
		 *
		 * `URLSearchParams.keys()` is an iterator with no `length`, so `slice`
		 * read length 0 and returned an empty array: this delete loop never ran
		 * once. The link therefore ACCUMULATED. A buyer who put 3 into M, then
		 * put M back to 0 because they only wanted the two L, carried
		 * `tailles[M]=3` into the studio anyway, and three garments nobody
		 * ordered reached the basket panel as sizes to press.
		 */
		Array.from(params.keys()).forEach(function (key) {
			if (key === 'qte' || key === 'taille' || key.indexOf('tailles[') === 0) {
				params.delete(key);
			}
		});

		// A SIZE AND A COUNT, never a bare count: the studio would otherwise
		// have to invent the size, and it invented whichever one its 3D preview
		// was showing.
		if (state.mode === 'grid' && state.gridTotal > 0) {
			Object.keys(state.sizes).forEach(function (size) {
				params.set('tailles[' + size + ']', String(state.sizes[size]));
			});
		} else if (state.qty > 1 && state.size) {
			params.set('tailles[' + state.size + ']', String(state.qty));
		}

		if (cfg.maxQty && state.typed > cfg.maxQty) {
			// Past the cap nothing is carried: the customer is being sent to the
			// devis, not to the editor.
			Array.from(params.keys()).forEach(function (key) {
				if (key === 'qte' || key.indexOf('tailles[') === 0) params.delete(key);
			});
		}

		personnaliser.href = url.toString();
	}

	/**
	 * Keep the devis form on the same quantity the buyer just chose.
	 *
	 * "Demander un devis" is an in-page anchor, so nothing reloads and the
	 * form's own fields were still holding whatever the server rendered on
	 * load. A buyer who set 400 in the buy box, followed the CTA the threshold
	 * had just made primary, and submitted, sent a request for ONE piece: the
	 * exact buyers the threshold exists to route here were the ones it misled.
	 */
	function mirrorIntoQuoteForm(state) {
		var form = document.querySelector('.ts-devis__form');
		if (!form) return;

		var qte = form.querySelector('input[name="qte"]');
		if (qte) qte.value = String(state.mode === 'grid' ? state.gridTotal || 1 : state.typed);

		var faces = form.querySelector('input[name="faces"]');
		if (faces) faces.value = String(state.faces);

		Array.prototype.forEach.call(form.querySelectorAll('input[name^="tailles"]'), function (el) {
			el.parentNode.removeChild(el);
		});
		var sizes = state.mode === 'grid' ? state.sizes : state.size && state.qty > 1 ? mapOne(state) : {};
		Object.keys(sizes).forEach(function (size) {
			var input = document.createElement('input');
			input.type = 'hidden';
			input.name = 'tailles[' + size + ']';
			input.value = String(sizes[size]);
			form.appendChild(input);
		});
	}

	function mapOne(state) {
		var one = {};
		one[state.size] = state.qty;
		return one;
	}

	var inFlight = 0;
	var overCapShown = false;

	/** The estimator's state as a query string, for the one reload it can need. */
	function buildQuery(state) {
		var p = new URLSearchParams();
		p.set('mode', state.mode);
		p.set('faces', String(state.faces));
		if (state.mode === 'grid') {
			Object.keys(state.sizes).forEach(function (size) {
				p.set('tailles[' + size + ']', String(state.sizes[size]));
			});
		} else {
			p.set('qte', String(state.typed));
			if (state.size) p.set('taille', state.size);
		}
		return '?' + p.toString();
	}

	function refresh() {
		var state = readForm();
		showPanes(state.mode);

		if (gridTotal) {
			gridTotal.textContent = String(state.gridTotal);
		}
		updateStudioLink(state);
		mirrorIntoQuoteForm(state);

		if (cfg.maxQty && state.typed > cfg.maxQty) {
			/*
			 * Past the cap the page stops pricing rather than quietly reducing.
			 *
			 * Asking the server for a clamped quantity printed two numbers on
			 * one screen: "Total 30 000 pièces" beside "10 000 pièces,
			 * 94 200,00 EUR HT", for a run the cart refuses outright. Reload so
			 * the server renders the honest state, once, rather than every
			 * keystroke.
			 */
			if (!overCapShown) {
				overCapShown = true;
				window.location.assign(form.action + buildQuery(state));
			}
			return;
		}
		overCapShown = false;

		// Built with URL, never by appending '?': with plain permalinks
		// `restUrl` already carries one, and a second makes every quote 404.
		var url = new URL(cfg.restUrl + 'quote', window.location.href);
		url.searchParams.set('garment', cfg.garment);
		url.searchParams.set('qty', String(state.qty));
		url.searchParams.set('faces', String(state.faces));

		var token = ++inFlight;
		estimate.setAttribute('data-busy', '1');

		fetch(url.toString(), { credentials: 'same-origin', headers: { accept: 'application/json' } })
			.then(function (response) {
				return response.ok ? response.json() : Promise.reject(new Error('quote'));
			})
			.then(function (quote) {
				// A slow answer must never overwrite a newer one: the customer
				// would read a total for a quantity they have already changed.
				if (token !== inFlight) {
					return;
				}
				estimate.removeAttribute('data-busy');
				paint(quote, state);
			})
			.catch(function () {
				if (token !== inFlight) {
					return;
				}
				estimate.removeAttribute('data-busy');
				/*
				 * EVERY FIGURE GOES, not just the unit line.
				 *
				 * Writing the error into one paragraph and leaving the rest left
				 * "1 pièce, 1 face imprimée / 14,50 EUR HT" on screen beside a
				 * quantity field reading 300, and hid the quote-threshold notice
				 * at whatever the server had decided on load. A stale total that
				 * looks current is worse than no total.
				 */
				if (out.summary) out.summary.textContent = '';
				if (out.totalHt) out.totalHt.textContent = '';
				if (out.totalTtc) out.totalTtc.textContent = '';
				if (out.discount) out.discount.textContent = '';
				if (out.unit) out.unit.textContent = cfg.i18n.failed;
				estimate.setAttribute('data-failed', '1');
				if (recalc) {
					recalc.hidden = false;
				}
			});
	}

	/** Every sentence comes from PHP; this file never authors French copy. */
	function fill(template, values) {
		return String(template).replace(/%s/g, function () {
			return values.shift();
		});
	}

	function paint(quote, state) {
		estimate.removeAttribute('data-failed');
		if (recalc) recalc.hidden = true;
		if (out.summary) {
			var faces = fill(quote.sides > 1 ? cfg.i18n.faces : cfg.i18n.face, [String(quote.sides)]);
			out.summary.textContent = fill(quote.qty > 1 ? cfg.i18n.many : cfg.i18n.one, [
				String(quote.qty),
				faces,
			]);
		}
		if (out.totalHt && quote.display) {
			out.totalHt.textContent = quote.display.total_ht;
		}
		if (out.totalTtc && quote.display) {
			out.totalTtc.textContent = quote.display.total_ttc;
		}
		if (out.unit && quote.display) {
			out.unit.textContent = fill(cfg.i18n.unit, [quote.display.unit_ht]);
		}
		if (out.discount) {
			out.discount.textContent = quote.discount_rate
				? fill(cfg.i18n.discount, [String(Math.round(quote.discount_rate * 100))])
				: '';
		}

		/*
		 * The verdict is the server's, not a comparison made here.
		 *
		 * `needs_quote` comes out of Pricing::needs_quote, which the cart also
		 * consults, so the page and the basket can never disagree about whether
		 * this run is self-serve. Recomputing it from `cfg.quoteFrom` would be a
		 * second copy of the rule, and the amount trigger would be missing from
		 * it entirely.
		 */
		var mustQuote = !!quote.needs_quote;
		if (needsQuote) {
			needsQuote.hidden = !mustQuote;
		}
		if (personnaliser && devisLink) {
			personnaliser.classList.toggle('ts-cta--ghost', mustQuote);
			devisLink.classList.toggle('ts-cta--ghost', !mustQuote);
		}
		void state;
	}

	var timer = null;
	function schedule() {
		window.clearTimeout(timer);
		timer = window.setTimeout(refresh, 250);
	}

	form.addEventListener('input', schedule);
	form.addEventListener('change', schedule);
	form.addEventListener('submit', function (event) {
		// The GET fallback would reload the page for the same answer.
		event.preventDefault();
		refresh();
	});

	// Paint once so the panes match the selected mode even before anyone types,
	// and so the devis form starts on the same quantity as the buy box.
	var initial = readForm();
	showPanes(initial.mode);
	updateStudioLink(initial);
	mirrorIntoQuoteForm(initial);
})();
