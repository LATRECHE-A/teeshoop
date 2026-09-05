/**
 * The studio ↔ WooCommerce bridge.
 *
 * This file runs on the WordPress page, not in the studio. It is the only thing
 * standing between a cross-origin frame and the visitor's basket, so its whole
 * job is to be paranoid on the way in and precise on the way out.
 *
 * ON THE WAY IN, every message must satisfy all three:
 *   1. event.origin === the configured studio origin, compared with ===, never
 *      startsWith. A prefix test passes for "https://studio.teeshoop.com.evil.tld".
 *   2. event.source === our frame's contentWindow. Otherwise any other frame or
 *      opener on the page can speak in the studio's name.
 *   3. the payload is an object with a known `type`.
 *
 * ON THE WAY OUT, postMessage is always given the explicit studio origin as its
 * target. '*' would broadcast the reply, which carries cart totals, to whatever
 * document happens to occupy the frame at that moment.
 *
 * The nonce never crosses the boundary. The frame asks; this page acts.
 */
(function () {
	'use strict';

	var cfg = window.TEESHOOP_BRIDGE;
	if (!cfg || !cfg.studioOrigin) {
		return;
	}

	var container = document.querySelector('[data-teeshoop-studio]');
	var frame = container && container.querySelector('iframe');
	if (!frame) {
		return;
	}

	/** Messages we are willing to act on. Anything else is ignored in silence. */
	var HANDLERS = {
		'teeshoop:ready': onReady,
		'teeshoop:quote': onQuote,
		'teeshoop:add-to-cart': onAddToCart,
		'teeshoop:resize': onResize,
	};

	window.addEventListener('message', function (event) {
		if (event.origin !== cfg.studioOrigin) {
			return;
		}
		if (event.source !== frame.contentWindow) {
			return;
		}
		var data = event.data;
		if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
			return;
		}
		var handler = HANDLERS[data.type];
		if (handler) {
			handler(data);
		}
	});

	/** Always targeted, never '*'. */
	function send(message) {
		if (frame.contentWindow) {
			frame.contentWindow.postMessage(message, cfg.studioOrigin);
		}
	}

	function sendContext() {
		// Tell the studio which product it is decorating and what the shop calls
		// this garment. It has no other way to know: it is on another origin and
		// cannot read the page.
		send({
			type: 'teeshoop:context',
			productId: cfg.productId,
			garment: cfg.garment,
			locale: document.documentElement.lang || 'fr',
			// What the buy box collected before the customer clicked
			// Personnaliser. Validated on the server (Shortcode::preset) and
			// re-validated in the frame, because the frame trusts nothing it is
			// told, including us.
			preset: cfg.preset && typeof cfg.preset === 'object' ? cfg.preset : null,
			// The colourways this product can actually be bought in, with the
			// maker's own name and the swatch the shop MEASURED. Empty means
			// "this page restricts nothing", never "no colours".
			colours: Array.isArray(cfg.colours) ? cfg.colours : [],
			// The maker's own half-chest series, which is what the print grading
			// must scale by. Empty means "we never read this maker's size sheet",
			// and the studio then grades with its own chart, as it always did.
			sizeChart: cfg.sizeChart && typeof cfg.sizeChart === 'object' ? cfg.sizeChart : {},
		});
	}

	function onReady() {
		sendContext();
	}

	/*
	 * Announce, do not only answer.
	 *
	 * The studio offers `teeshoop:ready` a few times over the first couple of
	 * seconds and then gives up and falls back to its standalone flow. If this
	 * script attached its listener after the last offer, on a slow phone or
	 * behind a deferred bundle, the frame would sit there with no basket button
	 * and nothing to retry. Sending unprompted on the frame's own load event
	 * closes the race from this side, and a duplicate context is ignored: the
	 * studio locks onto the first one.
	 */
	if (frame.contentWindow) {
		frame.addEventListener('load', sendContext);
	}

	/**
	 * A price request. The answer comes from the server every time. There is no
	 * client-side price to fall back on, by design.
	 */
	function onQuote(data) {
		/*
		 * Built with URL, not by concatenating a '?'.
		 *
		 * With PRETTY permalinks `restUrl` is `…/wp-json/teeshoop/v1/` and
		 * appending `quote?garment=tee` works. With the PLAIN structure, which is
		 * what a fresh WordPress ships with, it is
		 * `…/index.php?rest_route=/teeshoop/v1/` and the same concatenation
		 * produces a second '?', so PHP reads the route as
		 * `/teeshoop/v1/quote?garment=tee` and answers 404. Every quote silently
		 * failed on such a shop while add-to-cart, which appends no query,
		 * worked perfectly. Measured on the local mirror, 2026-08-14.
		 */
		var url = new URL(cfg.restUrl + 'quote', window.location.href);
		url.searchParams.set('garment', String(data.garment || cfg.garment));
		url.searchParams.set('qty', String(parseInt(data.qty, 10) || 1));
		(data.sides || []).forEach(function (side, i) {
			url.searchParams.set('sides[' + i + '][id]', String(side.id || ''));
			url.searchParams.set('sides[' + i + '][area_sq_cm]', String(side.area_sq_cm || 0));
		});

		fetch(url.toString(), {
			credentials: 'same-origin',
			headers: { accept: 'application/json' },
		})
			.then(function (response) {
				return response.json().then(function (body) {
					return { ok: response.ok, body: body };
				});
			})
			.then(function (result) {
				send({
					type: 'teeshoop:quote-result',
					requestId: data.requestId || null,
					ok: result.ok,
					quote: result.ok ? result.body : null,
					error: result.ok ? null : result.body.code || 'quote_failed',
				});
			})
			.catch(function () {
				send({
					type: 'teeshoop:quote-result',
					requestId: data.requestId || null,
					ok: false,
					quote: null,
					error: 'network',
				});
			});
	}

	/**
	 * Add to basket.
	 *
	 * Note what is not forwarded: whatever price the studio believes. The body
	 * carries the customer's choices, and the server prices them.
	 *
	 * The reply echoes `requestId` for the same reason a quote's does. It is not
	 * that two adds are expected in flight (the studio refuses to start a second
	 * one), it is that a reply which cannot be matched to a request has to be
	 * guessed at, and the thing being guessed at here is whether a basket now
	 * contains a paid line.
	 */
	function onAddToCart(data) {
		var requestId = typeof data.requestId === 'string' ? data.requestId : null;

		fetch(cfg.restUrl + 'cart', {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'content-type': 'application/json',
				'X-WP-Nonce': cfg.nonce,
			},
			body: JSON.stringify({
				product_id: cfg.productId,
				garment: data.garment || cfg.garment,
				qty: parseInt(data.qty, 10) || 1,
				sides: Array.isArray(data.sides) ? data.sides : [],
				design_id: String(data.designId || ''),
				size_grid: data.sizeGrid && typeof data.sizeGrid === 'object' ? data.sizeGrid : {},
			}),
		})
			.then(function (response) {
				return response.json().then(function (body) {
					return { status: response.status, ok: response.ok, body: body };
				});
			})
			.then(function (result) {
				if (result.ok) {
					send({
						type: 'teeshoop:cart-result',
						requestId: requestId,
						ok: true,
						cartCount: result.body.cart_count,
						cartUrl: result.body.cart_url,
						message: cfg.i18n.added,
					});
					document.body.dispatchEvent(
						new CustomEvent('teeshoop:added', { detail: result.body })
					);
					return;
				}
				send({
					type: 'teeshoop:cart-result',
					requestId: requestId,
					ok: false,
					error: result.body.code || 'cart_failed',
					message: result.status === 403 ? cfg.i18n.expired : cfg.i18n.failed,
				});
			})
			.catch(function () {
				send({
					type: 'teeshoop:cart-result',
					requestId: requestId,
					ok: false,
					error: 'network',
					message: cfg.i18n.failed,
				});
			});
	}

	/**
	 * Let the studio ask for a taller frame.
	 *
	 * Clamped: an unbounded height from the frame is a way to push the rest of the
	 * page, including the theme's own controls, off the screen.
	 *
	 * And clamped again to the BROWSER WINDOW, which only this side can see. The
	 * studio's modals are `position: fixed`, which inside an iframe means fixed
	 * to the iframe and not to the visual viewport: a frame taller than the
	 * window puts the bottom of a dialog somewhere no amount of scrolling
	 * reaches. Measured with the add-to-cart panel, which asked for about
	 * 1 200 px in a 1 000 px window and moved its own confirm button out of the
	 * world. A dialog that scrolls inside a frame you can see beats a dialog you
	 * cannot finish.
	 */
	function onResize(data) {
		var height = parseInt(data.height, 10);
		if (!height || height < 320 || height > 4000) {
			return;
		}
		height = Math.max(320, Math.min(height, window.innerHeight));
		container.style.setProperty('--teeshoop-studio-height', height + 'px');
	}
})();
