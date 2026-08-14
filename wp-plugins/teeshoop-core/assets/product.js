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

		var qty;
		if (mode === 'grid') {
			qty = total;
		} else {
			var qtyInput = form.querySelector('input[name="qte"]');
			qty = qtyInput ? parseInt(qtyInput.value, 10) : 1;
		}
		if (!qty || qty < 1) {
			qty = 1;
		}
		if (cfg.maxQty && qty > cfg.maxQty) {
			qty = cfg.maxQty;
		}

		return { mode: mode, faces: faces, qty: qty, sizes: sizes, gridTotal: total };
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
		Array.prototype.slice.call(params.keys()).forEach(function (key) {
			if (key === 'qte' || key.indexOf('tailles[') === 0) {
				params.delete(key);
			}
		});
		if (state.mode === 'grid' && state.gridTotal > 0) {
			Object.keys(state.sizes).forEach(function (size) {
				params.set('tailles[' + size + ']', String(state.sizes[size]));
			});
		} else if (state.qty > 1) {
			params.set('qte', String(state.qty));
		}
		personnaliser.href = url.toString();
	}

	var inFlight = 0;

	function refresh() {
		var state = readForm();
		showPanes(state.mode);

		if (gridTotal) {
			gridTotal.textContent = String(state.gridTotal);
		}
		updateStudioLink(state);

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
				// Say what happened and offer the way out, rather than leaving a
				// stale total on screen pretending to be this quantity's.
				if (out.unit) {
					out.unit.textContent = cfg.i18n.failed;
				}
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

	// Paint once so the panes match the selected mode even before anyone types.
	showPanes(readForm().mode);
	updateStudioLink(readForm());
})();
