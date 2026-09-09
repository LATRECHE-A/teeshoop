<?php
/**
 * The colour of a garment, measured.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The supplier ships colour NAMES, and a colour value for one in five of them.
 * « Navy », « Navy Blue », « French Navy », « Deep Navy » and « Midnight » are
 * five different articles, and the catalogue may never merge them: a buyer
 * ordering a re-run in eighteen months needs the name they bought. But a filter
 * with 1 331 text labels in a scrolling box is not a colour filter, it is a
 * dictionary. (442 names and none valued when this was written; 1 331 names on
 * the mirror of 9 September 2026, of which 60 carry a declared value.)
 *
 * So the value is MEASURED, from what the supplier ships per colourway.
 *
 * THE DECLARED HEXADECIMAL IS THE VALUE WHEN THERE IS ONE
 * (`Catalogue::META_COLOUR_HEX`, `declared()` below). Since 9 September 2026
 * the supplier states the colour as a number rather than as a picture of one.
 * That is the same statement as the chip with the JPEG, the lamp and the
 * segmentation removed, so it wins over both images below. MEASURED on its
 * catalogue: 14 568 of 75 088 variants carry one, so the two image roads are
 * still the answer for four fifths of the shop.
 *
 * THE CHIP IS THE VALUE NEXT (`Catalogue::META_COLOUR_CHIP`). It is a flat patch of
 * the dye: MEASURED on eleven of them, between 99,2 % and 100 % of the frame is
 * a single colour and the 90th-centile distance from its own median is 0,0. So
 * it is the colour the maker DECLARES, delivered as an image rather than as
 * text, and it is what gets published.
 *
 * THE PHOTOGRAPH IS THE CHECK, AND THE FALLBACK
 * (`Catalogue::META_COLOUR_PHOTO`). It is measured separately and the distance
 * between the two is recorded, because the supplier is known to reuse one
 * colourway's shot for another and a garment that does not match its own chip
 * is what that looks like from here. MEASURED on the last full sweep: 396 of
 * the 397 checks produce a number and 44 of those are further than 0,12. The
 * disagreement is reported to the operator and never refuses the swatch, since
 * the chip is the half that is right. When no chip can be read the photograph
 * becomes the value, and the record says so on that colour's row.
 *
 * All three paths end at `centre()`. There is ONE rule for « what colour is
 * this », the marginal median in OKLab, and three ways of bringing it values.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CMYK IS NOT A FOURTH ROAD, AND THAT IS A DECISION, NOT AN OVERSIGHT
 *
 * MEASURED on the supplier's catalogue: 75 074 of 75 088 variants carry a CMYK
 * string (« 0 74 99 0 ») against 14 568 carrying a hexadecimal. It covers
 * 99,98 % of the shop and it is the obvious way to fill the gap.
 *
 * It is refused. CMYK without an ICC profile names no colour: the same four
 * numbers are a different ink on every press, paper and profile, and every
 * published formula for converting them (the naive 1-min, Adobe's US Web
 * Coated, a browser's) lands somewhere else. The result would look plausible on
 * a filter and be an invention, which is exactly what a fabricated print size
 * is: a number that reaches a customer and was not derived. The photograph of
 * the actual garment IS a measurement of the actual dye, so the fallback that
 * already exists is strictly better than a conversion of a device-dependent
 * quadruple. If a profile ever arrives from the supplier (question Q71), this is
 * where it would go, and it would go in as a cross-check first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS NOT
 *
 * It is not a dye reference. A chip is what the maker declares, and it says
 * nothing about the fabric or the light the buyer will see the garment under: a
 * satin polyester photographs lighter than the cotton dyed in the same bath.
 * The interface says so where it is read, and `QUESTIONS-ASSOCIE.md` question
 * 49 asks the associate for real references, which would supersede this the day
 * they arrive.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO WORDPRESS AND NO GD IN THIS FILE
 *
 * It takes an array of packed integers and returns numbers, so
 * `tests/run.php` exercises every branch on a machine with neither. The
 * decoding, the fetching and the storing are `Colours`, which is the half that
 * cannot be tested without a shop. The maths is the half that must be.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Swatch {

	/**
	 * The width every photograph is reduced to before it is measured.
	 *
	 * MEASURED on the mirror, decode plus scale plus read, mean of six supplier
	 * photographs of 1024 px: 41 ms at 320 px, 26 ms at 256, 16 ms at 192, 12 ms
	 * at 128. 256 keeps roughly 33 000 garment pixels, which is four orders of
	 * magnitude more than a median needs, for 14 ms more than the cheapest
	 * option. Below 192 the erosion below starts eating thin sleeves.
	 */
	public const WORK_W = 256;

	/** Thickness in px of the border ring sampled to identify the ground. */
	private const RING = 2;

	/**
	 * How far a pixel may sit from the ground colour and still be ground.
	 *
	 * Euclidean in sRGB, where the full diagonal is 441. MEASURED over 14
	 * supplier photographs: the ground is exactly (255,255,255) on all of them
	 * and its own 90th percentile deviation is 0,0, so the tolerance exists for
	 * JPEG ringing along the silhouette, not for a gradient.
	 *
	 * IT WAS 10 AND THAT ATE A GARMENT. « Snowwhite » photographs at about
	 * rgb(250,250,248), which is 9,9 from the ground: inside a tolerance of 10,
	 * so the fill walked straight through the shirt and the colour came back as
	 * « sujet absent ». At 6 the palest garment in the catalogue survives and
	 * the ringing does not, and what the erosion below is for is the rest.
	 */
	private const TAU = 6.0;

	/**
	 * Refuse a photograph whose ground is not uniform.
	 *
	 * 90th percentile of the border ring's own deviation from its median. A
	 * lifestyle shot, a model on a street, a gradient backdrop: none of them can
	 * be segmented by this method, and the honest answer is no swatch. Set at
	 * 12, which is 40 % above the worst ring seen (0.0 on all fourteen) plus the
	 * headroom a heavily compressed JPEG needs.
	 */
	private const RING_MAX = 12.0;

	/** Px of foreground erosion, to drop the blend halo the downscale creates. */
	private const ERODE = 2;

	/*
	 * ── The colour chip ──────────────────────────────────────────────────────
	 *
	 * The supplier ships one per colourway, `sku_color_swatch_url`: a flat patch
	 * of the dye rather than a photograph of a garment. MEASURED on eleven of
	 * them: between 99,2 % and 100 % of each frame is a single colour and the
	 * 90th percentile deviation from its median is 0,0 on all eleven. That makes
	 * it the DECLARED colour, and it needs none of the segmentation above.
	 *
	 * THERE IS NO BORDER TRIM, and there was one until it was tested. The 0,8 %
	 * of a real chip that is not flat is at the edge, where the JPEG rings
	 * against the frame, and trimming it looked obviously right. It changes
	 * nothing: a marginal median over twenty thousand pixels does not move for
	 * a hundred and seventy outliers, and the check below tolerates far more
	 * than that. Breaking the trim on purpose failed to break a single test,
	 * which is the whole argument against keeping a constant nobody can prove.
	 *
	 * TELLING A CHIP FROM A GARMENT PHOTOGRAPH IS NOT A FLATNESS TEST, and the
	 * first version of this got that wrong. A cut-out on white is two flat
	 * colours: measure how much of it sits on one of the two and the answer is
	 * « all of it », so a photograph sailed through and the shop would have
	 * published the colour of the backdrop. Flatness is still checked, because a
	 * chip that is neither flat nor split is not a chip either, but it is not
	 * what refuses a cut-out and this paragraph used to claim that it was.
	 *
	 * WHAT SEPARATES THEM IS THAT A GROUND SURROUNDS ITS SUBJECT, and the way to
	 * ask it is to count the BORDER RING, not the sides. Counting sides (« one
	 * colour touches all four and the other none ») is the same question asked
	 * so coarsely that a single sleeve reaching the left edge answers it wrong,
	 * and the backdrop is then published as the primary colour.
	 *
	 * BORD_MIN IS MEASURED, ON BOTH POPULATIONS. Over the 79 real two-tone chips
	 * in this catalogue the smaller cluster owns between 0,2192 and a half of
	 * the border ring. Over cut-outs built for this: 0,0000 touching no edge,
	 * 0,0651 with a sleeve on 30 % of one edge, 0,1079 on 50 %, 0,1952 on 90 %,
	 * and 0,1849 cropped along a whole edge. The two populations are 0,1952
	 * against 0,2192 apart at their closest, so the bound sits between them at
	 * 0,20 and refuses no real chip in this catalogue.
	 *
	 * IT DOES NOT SEPARATE EVERYTHING, and saying so is the point: a garment
	 * cropped along TWO edges measures 0,4161 and passes as a chip. That is not
	 * a shape this supplier ships, and refusing a chip only costs a fall back to
	 * the photograph, while accepting a cut-out costs the backdrop's colour on
	 * the filter. The bound is set on the side that is cheap to be wrong on.
	 */
	private const CHIP_FLAT = 0.60;
	private const CHIP_NEAR = 0.03;
	private const BORD_MIN  = 0.20;

	/**
	 * The share of the frame the garment must occupy.
	 *
	 * MEASURED: the fourteen reference photographs land between 39,8 % and
	 * 44,9 %. Below 3 % there is no garment in the frame, or the fill leaked
	 * through it and ate the garment.
	 */
	private const MIN_FRAC = 0.03;

	/**
	 * And the share the GROUND must occupy, which is a different question.
	 *
	 * « Is there a garment here » and « is this a cut-out at all » are two
	 * failures with two answers, and the first version could only ask the first.
	 * It capped the garment at 97 % of the frame AFTER the erosion, and the
	 * erosion alone takes about 3 % off a 256 px frame, so the cap sat exactly
	 * where it could never be reached: a gate that cannot fail. Measured before
	 * this was rewritten, on a frame that is 97,2 % subject: the check passed.
	 *
	 * Asked the right way round it is reachable and it means something. A
	 * cut-out on white is half ground. A photograph whose fill removes less
	 * than a tenth of the frame is not one, whatever its border looked like.
	 */
	private const GROUND_MIN = 0.10;

	/**
	 * When one photograph holds two colours.
	 *
	 * 47 of the 442 names are two-tone (« Navy/White », « Grey/Lime »), and one
	 * of them is « Navy/Navy », which is why the NAME may never decide this. A
	 * single swatch for a raglan is wrong 47 times.
	 *
	 * WHAT DOES NOT WORK: comparing the distance between the two centres to the
	 * scatter inside them. Work it out for a garment lit by a smooth ramp, which
	 * is every photograph ever taken: k-means cuts the ramp in half, the centres
	 * land a quarter of the range either side of the middle, and the ratio comes
	 * out at four whatever the range is. The test passes on one dye every time.
	 *
	 * WHAT DOES: the GAP. Two dyes leave the middle of the segment between them
	 * empty, because a garment is navy or it is white and almost no pixel is
	 * halfway. A ramp fills that middle.
	 *
	 * THE MARGIN IS MEASURED, NOT ARGUED. The first version of this paragraph
	 * reasoned that « a uniform ramp puts exactly a third of its pixels in the
	 * middle third, so 0,12 refuses it by a factor of three ». That is wrong:
	 * the projection runs from one CENTRE to the other, not from one end of the
	 * ramp to the other, so the middle third of the projection is not the middle
	 * third of the range. Measured by running the real `split()` and `gap()` on
	 * a ramp of one dye: 0,131 (navy), 0,166 (red), 0,173 (grey), 0,243 (a
	 * narrow ramp). The bound holds, by 1,09 rather than by three.
	 *
	 * AND ON A SMOOTH RAMP IT IS NOT THE TEST THAT FIRES. The same measurement
	 * gives those four ramps a separation of 0,008 to 0,078, all under SEP_MIN,
	 * so a photograph of one dye lit unevenly is refused a second stop for being
	 * two centres too close together, and the gap never gets asked. The gap
	 * earns its place on the HARD shadow, where the middle really is empty:
	 * there it reads 0,0000, exactly like two dyes, and only `same_dye()` below
	 * tells them apart.
	 */
	private const SEP_MIN   = 0.09;
	private const GAP_MAX   = 0.12;
	private const MINOR_MIN = 0.18;

	/** Deterministic k-means: seeds at these quantiles of the widest axis. */
	private const SEED_LO = 0.05;
	private const SEED_HI = 0.95;
	private const KMEANS_ROUNDS = 12;

	/**
	 * ONE DYE UNDER TWO LIGHTS LOOKS EXACTLY LIKE TWO DYES, except for this.
	 *
	 * A hard shadow, a folded sleeve, a hood, a panel out of the light: one
	 * dye, two lighting levels, no pixels in between. The histogram is bimodal
	 * with an empty middle, so the gap reads 0,0000, which is what two dyes
	 * read. MEASURED by building exactly that and running the real code: a
	 * white garment with a shadow over 30 % of it at 60 % of the light gives
	 * separation 0,1530, minor share 0,300 and gap 0,0000, so it is published
	 * as TWO colours and the second one is the shadow.
	 *
	 * WHAT TELLS THEM APART IS COLORIMETRY, not statistics. Illumination
	 * multiplies the linear LMS by a scalar; OKLab's three coordinates are
	 * linear in the CUBE ROOTS of LMS, so they are all multiplied by the cube
	 * root of that scalar. Hue and C/L are therefore preserved EXACTLY, and two
	 * lighting levels of one dye lie on a ray through the origin.
	 *
	 * MEASURED on built images, white, yellow, sky blue and navy, at 30 % to
	 * 75 % of the light: the two centres differ by at most 2,26 degrees of hue
	 * and 0,031 of saturation. Two real dyes differ by 122 degrees or more, or
	 * by 0,088 of saturation when one of them is a neutral whose hue means
	 * nothing. Both bounds sit at roughly twice the residue and a half of the
	 * real difference.
	 *
	 * IT ONLY APPLIES TO A PHOTOGRAPH. A chip is an aplat, and there is no
	 * illumination in it to explain away two flat colours: MEASURED on the 42
	 * two-tone chips in this catalogue, five of them (« Black/White »,
	 * « Charcoal Heather », « Light Grey Marl/Black » among them) are two
	 * neutrals whose hue and saturation are identical, and this rule would fold
	 * every one of them into a single grey.
	 *
	 * A genuine two-tone garment whose halves are two NEUTRALS, photographed,
	 * is folded into one and its name then refuses it. That is the conservative
	 * side: no photograph can separate « black and dark grey » from « black in
	 * a shadow », and a colour with no swatch costs less than a swatch that is
	 * half shadow.
	 */
	private const H_LUM = 6.0;
	private const S_LUM = 0.05;

	/**
	 * How far one photograph may sit from the others and still be the same dye.
	 *
	 * OKLab euclidean. Two shots of « Navy » on two different styles are two
	 * fabrics under two lamps, so they never match exactly: MEASURED across the
	 * catalogue, colours that agree land under 0,05 and the disagreements are an
	 * order of magnitude worse.
	 *
	 * THE FIRST VERSION REFUSED THE WHOLE COLOUR when any one photograph sat
	 * beyond this, and it threw away « Asphalt », « Black Pure » and « Apple
	 * Green », all of which have four good photographs and one odd one. A single
	 * bad shot is not a reason to leave a colour out of the filter. So the
	 * outlier is dropped and the rest are used, and a colour is refused only
	 * when the survivors are no longer a majority: at that point the name
	 * genuinely covers two different dyes and no single swatch is true.
	 */
	private const AGREE_MAX = 0.055;

	/*
	 * ── The family boundaries ────────────────────────────────────────────────
	 *
	 * THE STRUCTURE IS PUBLISHED, THE NUMBERS ARE MEASURED.
	 *
	 * Wang, Luo, Kang, Choh and Kim, « An Algorithm for Categorising Colours
	 * into Universal Colour Names », CGIV 2006, pages 426 to 430, fitted
	 * boundaries to 2 916 namings of 729 printed patches by ten observers,
	 * against Berlin and Kay's eleven basic terms. Their model is staged, and
	 * the stages are the important part: the achromatic decision first, then
	 * the three names that need lightness and chroma as well as hue (brown,
	 * pink, yellow), then the rest by hue alone. This file follows that order.
	 *
	 * Their CIELAB numbers were converted to OKLCh over L* 25 to 85 and C*ab 15
	 * to 65 (D50, Bradford to D65). Most boundaries land within five degrees;
	 * the blue/purple one lands within twenty-five, which is CIELAB's blue
	 * non-linearity and the reason OKLab exists, so that one is set from the
	 * catalogue instead of from the conversion.
	 *
	 * WHERE THE PUBLISHED MODEL DOES NOT SURVIVE A GARMENT.
	 *
	 * The achromatic gate. Theirs is an absolute chroma, C*ab <= 5, which is
	 * OKLab C ~ 0,014, and their looser working figure is 0,030. MEASURED on
	 * this catalogue: navy is C=0,028 at L=0,257 and off-white is C=0,020 at
	 * L=0,909. At 0,014 the off-white becomes an orange; at 0,030 the navy
	 * becomes a black. No absolute chroma separates them, because their
	 * lightnesses differ by a factor of three and a printed patch book does not
	 * span that. SATURATION does: C/L is 0,109 and 0,022, which is the classical
	 * CIELUV definition.
	 *
	 * BUT C/L ALONE BREAKS AT THE DARK END, and the catalogue said so. The ratio
	 * lets a colour be chromatic on less and less chroma as it darkens, which is
	 * backwards: a surface of a given chroma reads as LESS colourful as it
	 * darkens, not more (the Hunt effect). « Pitch Black » measures C=0,031 at
	 * L=0,118 and was published as a blue; « Titanium » and « Dark Heather »
	 * were published as blues at C=0,018. So the denominator is floored at
	 * L_SAT: above it the statistic is the classical ratio, below it, it is
	 * absolute chroma on a fixed scale.
	 *
	 * L_SAT IS THE CENTRE OF THE WINDOW IN WHICH EVERY MOVE IS AN IMPROVEMENT.
	 * Under 0,551 « Pitch Black » is still a blue. Over 0,603 « Ink » (C=0,022
	 * at L=0,359) stops being a navy and « Clay » (C=0,024 at L=0,555) stops
	 * being a beige. Inside it, five colours move and all five move the right
	 * way: « Pitch Black » and « Black/Dark Grey » to the blacks, « Titanium »
	 * and « Dark Heather » to the greys, « Grape » out of the reds.
	 *
	 * The pink gate. Theirs is a lightness gate, and it is right: pink is a
	 * light red. It is what keeps bordeaux (L=0,380) in the reds while raspberry
	 * (L=0,597) goes to the pinks, at hues eleven degrees apart.
	 */
	private const S_NEUTRE = 0.037;
	private const L_SAT    = 0.580;
	private const L_CLAIR  = 0.850;
	private const L_SOMBRE = 0.300;

	/*
	 * BROWN IS NOT A HUE, and the evidence is threefold.
	 *
	 * Colorimetrically, Wang and Luo's brown block spans hue 20 to 80 in
	 * CIELAB, which sits ENTIRELY inside their own red and orange hue ranges.
	 * What separates it is L* < 60 and C*ab <= 45, that is, lightness and
	 * chroma.
	 *
	 * Perceptually, brown is a related colour: it does not exist as an isolated
	 * stimulus. The same light seen on its own looks orange at any intensity,
	 * and reads as brown only when it is dark against a brighter surround, so
	 * the eye takes it for a surface of low reflectance. Bartleson (1976) also
	 * found that desaturating a stimulus makes it browner.
	 *
	 * Empirically, on the 68 names in the xkcd colour survey whose head noun is
	 * brown or orange and whose hue falls in the band they share, the best
	 * single threshold on chroma names 65 of 68 correctly and the best single
	 * threshold on lightness names 53. Both are used here, as the published
	 * model does.
	 *
	 * And the same argument one arc further round gives olive, which the trade
	 * calls kaki and files with the greens: rgb(128,128,0) is EXACTLY pure
	 * yellow's hue at half its lightness.
	 *
	 * THE BAND IS THE ORANGE AND YELLOW ARCS, NOT TWO MORE NUMBERS. Brown is
	 * dark orange and kaki is dark yellow, so the band's edges and its internal
	 * split ARE those boundaries, and they cannot drift apart from them. The
	 * catalogue agrees: its browns run from « Roasted Coffee » at 32,8 to
	 * « Brown Savana » at 63,8 and its olives from « Moss » at 89,6 to « Urban
	 * Khaki » at 114,1, so the split at 77,2 sits inside a gap of 26 degrees.
	 * The band used to start at 16,0, which put « Cardinal Red » (h=16,4) in
	 * the browns while « Deep Red » (h=15,1) stayed a red.
	 *
	 * AND IT STOPS AT L_CLAIR. « Washed out at any lightness » made a beige of
	 * every pale warm tint, « Sunshine » and « Amalfi Yellow » among them. Above
	 * L_CLAIR a washed-out warm colour is a cream and the arcs decide it;
	 * MEASURED, that moves five (Yellow Haze, Soft Yellow, Amalfi Yellow,
	 * Sunshine, Anise Flower) and leaves every beige where it was, the lightest
	 * being « Union Beige » at L=0,838.
	 */
	private const H_TERRE_MIN   = self::H_ROUGE_ORANGE;
	private const H_TERRE_MAX   = self::H_JAUNE_VERT;
	private const H_TERRE_SPLIT = self::H_ORANGE_JAUNE;
	private const L_TERRE       = 0.660;
	private const C_TERRE       = 0.140;
	private const C_TERNE       = 0.090;

	/**
	 * WHERE THE MEASUREMENT STOPS BEING ABLE TO DECIDE, AND THE NAME DOES.
	 *
	 * MEASURED over the whole catalogue, 442 colours: every single disagreement
	 * between what the images show and what the maker's own word says is a
	 * NEARLY NEUTRAL colour. « Pink » is C=0,022 at L=0,948 and « Grey Fog » is
	 * C=0,026 at L=0,865: one is a pink and the other is a grey, they are one
	 * thousandth of chroma apart, and nothing in an image separates them. Below
	 * this saturation, hue and lightness carry almost no information and the
	 * word carries more. « Black Melange » is the same argument at the other
	 * end: it measures a mid grey because that is what a black melange looks
	 * like, and only the label knows it is sold as a black.
	 *
	 * So under S_FLOU, and ONLY under it, the maker's word decides the family.
	 * Above it a disagreement is a real error and is still refused: at C=0,1 a
	 * garment the label calls navy and the image calls green is one of the two
	 * being wrong, and we do not know which.
	 *
	 * THE SWATCH IS NEVER THE NAME'S. Only the grouping can move. The colour a
	 * buyer sees is the one that was measured, always, in every branch.
	 *
	 * 1,5 times the achromatic threshold. MEASURED on the whole catalogue, it
	 * moves 41 colours and « Pitch Black » at 0,0528 is the last one inside it,
	 * so every saturated colour is out. Eight disagreements are left above it
	 * and every one of them is refused; docs/COULEURS.md names them.
	 */
	private const S_FLOU = 0.0555;

	/**
	 * PINK IS A LIGHT RED, and this is the only place that says so.
	 *
	 * It used to be said twice. The gate here required lightness, and then the
	 * hue arcs handed « rose » to every dark magenta anyway, so « Wine »
	 * (L=0,395) and « Heather Burgundy » (L=0,442) were published as pinks
	 * against their own names. Rose has left the arcs; this is its one home.
	 *
	 * L_ROSE, MEASURED, is the narrowest boundary in the file. Inside the pink
	 * hue window the reds reach L=0,487 (« Red/Snowwhite ») and the pinks start
	 * at L=0,493 (« Dark Pink »): six thousandths. In the magenta window the
	 * reds reach 0,442 (« Heather Burgundy ») and the pinks start at that same
	 * 0,493, which is where 0,49 comes from.
	 *
	 * H_ROSE, MEASURED: above L_ROSE the pinks reach h=18,04 (« Fluorescent
	 * Pink ») and the reds start at h=20,12 (« Sport Scarlet Red »).
	 *
	 * WANG AND LUO'S CHROMA BOUND IS NOT KEPT. On the 41 labelled pinks and reds
	 * it excludes one true pink (« Fuchsia Organic », C=0,245) and no red at all:
	 * the most chromatic red, « Fire Red » at C=0,237, is already outside the
	 * hue window at h=27,5. Lightness and hue carry this separation and chroma
	 * does not, so a bound that only ever fired wrongly is gone.
	 *
	 * ONE COLOUR IS LEFT ON THE WRONG SIDE. « Magenta » (L=0,365 at h=345,4) is
	 * sold as a pink and is DARKER than « Heather Burgundy » (L=0,442), sold as
	 * a red, three tenths of a degree away in hue. No lightness separates them.
	 * This file calls it a red, the check catches it, and it is refused.
	 */
	private const L_ROSE = 0.490;
	private const H_ROSE = 19.1;

	/**
	 * The hue boundaries, each one measured on the catalogue's own labels.
	 *
	 * The conversion of Wang and Luo's CIELAB boundaries put these near the
	 * MIDPOINTS between the sRGB references (red 29,2 · orange 53,0 · yellow
	 * 109,8 · green 142,5 · cyan 194,8 · blue 264,1 · magenta 328,4). A midpoint
	 * between two primaries is not where a name changes: the eye calls
	 * rgb(255,88,0) orange although its hue is nearer red's than orange's, and
	 * the old boundary at 40,0 duly published « Orange », « T. Orange » and
	 * « Sunset Orange » as reds.
	 *
	 * So each boundary is set from the 300 colours in this catalogue that carry
	 * an unambiguous colour word AND enough chroma for hue to mean anything.
	 * Those are labelled samples: the maker's own word for a colour it dyed.
	 * Where the two populations separate cleanly, the boundary is the middle of
	 * the gap and NOTHING is misfiled:
	 *
	 *   rouge | orange   reds reach 29,16 (Tomato Red), oranges start at 31,53
	 *                    (Sunset Orange).  Pure sRGB red, 29,23, stays a red.
	 *   orange | jaune   oranges reach 76,16 (Apricot), yellows start at 78,28
	 *                    (Mustard).
	 *   vert | bleu      greens reach 197,2 (Emerald Green), blues start at
	 *                    208,7 (Tropical Blue). 205,0 is already inside that
	 *                    gap and is left alone.
	 *   bleu | violet    blues reach 276,2 (Navy Pure), violets start at 278,7
	 *                    (Dark Purple). It was at 285,0, inside the violets,
	 *                    and published « Purple », « Violet », « Dark Purple »
	 *                    and « Urban Purple » as blues.
	 *   violet | magenta violets reach 305,6 (Meta Lilac), the magenta pinks
	 *                    start at 339,7 (Candy Pink). 321,0 is inside that gap.
	 *
	 * ONE BOUNDARY HAS NO GAP. The yellows reach 107,33 (Flo Yellow) and the
	 * greens start at 106,87 (Pixel Lime) and 108,11 (Safety Green): one
	 * fluorescent dye that the trade sells as a yellow and as a green. Pure sRGB
	 * yellow at 109,77 has to stay a yellow, so the boundary goes between it and
	 * the first lime that is not fluorescent, « Lime » at 114,97. That is 112,4,
	 * and it leaves Pixel Lime and Safety Green measured against their names.
	 * They are the two the catalogue cannot resolve, and they are refused.
	 */
	private const H_ROUGE_ORANGE = 30.4;
	private const H_ORANGE_JAUNE = 77.2;
	private const H_JAUNE_VERT   = 112.4;
	private const H_VERT_BLEU    = 205.0;
	private const H_BLEU_VIOLET  = 277.4;
	private const H_MAGENTA      = 321.0;

	/** The arcs, upper bound of each, walking the circle from the reds. */
	private const ARCS = array(
		array( self::H_ROUGE_ORANGE, 'rouge' ),
		array( self::H_ORANGE_JAUNE, 'orange' ),
		array( self::H_JAUNE_VERT, 'jaune' ),
		array( self::H_VERT_BLEU, 'vert' ),
		array( self::H_BLEU_VIOLET, 'bleu' ),
		array( self::H_MAGENTA, 'violet' ),
		array( 360.0, 'rouge' ),
	);

	// ═══════════════════════════════════════════════════════ colour space ══

	/** sRGB electro-optical transfer function, IEC 61966-2-1. */
	private static function linear( float $c ): float {
		$c /= 255.0;
		return $c <= 0.04045 ? $c / 12.92 : ( ( $c + 0.055 ) / 1.055 ) ** 2.4;
	}

	/**
	 * sRGB to OKLab, Ottosson's published matrices.
	 *
	 * OKLab rather than CIELAB because the hue of a blue stays put in it: in
	 * CIELAB, darkening a blue swings its hue towards purple by a visible
	 * amount, and this file classifies navies for a living.
	 *
	 * @return array{0:float,1:float,2:float} L, a, b
	 */
	public static function oklab( int $r, int $g, int $b ): array {
		$rl = self::linear( (float) $r );
		$gl = self::linear( (float) $g );
		$bl = self::linear( (float) $b );

		$l = 0.4122214708 * $rl + 0.5363325363 * $gl + 0.0514459929 * $bl;
		$m = 0.2119034982 * $rl + 0.6806995451 * $gl + 0.1073969566 * $bl;
		$s = 0.0883024619 * $rl + 0.2817188376 * $gl + 0.6299787005 * $bl;

		$l = $l < 0 ? -( ( -$l ) ** ( 1 / 3 ) ) : $l ** ( 1 / 3 );
		$m = $m < 0 ? -( ( -$m ) ** ( 1 / 3 ) ) : $m ** ( 1 / 3 );
		$s = $s < 0 ? -( ( -$s ) ** ( 1 / 3 ) ) : $s ** ( 1 / 3 );

		return array(
			0.2104542553 * $l + 0.7936177850 * $m - 0.0040720468 * $s,
			1.9779984951 * $l - 2.4285922050 * $m + 0.4505937099 * $s,
			0.0259040371 * $l + 0.7827717662 * $m - 0.8086757660 * $s,
		);
	}

	/**
	 * OKLab back to sRGB, clamped into gamut.
	 *
	 * A median of in-gamut colours can land marginally outside it, by a fraction
	 * of one 8-bit step. Clamping is the whole correction needed and a gamut
	 * mapper would be machinery for nothing.
	 *
	 * @param array{0:float,1:float,2:float} $lab
	 * @return array{0:int,1:int,2:int}
	 */
	public static function srgb( array $lab ): array {
		list( $capital_l, $a, $b ) = $lab;

		$l = ( $capital_l + 0.3963377774 * $a + 0.2158037573 * $b ) ** 3;
		$m = ( $capital_l - 0.1055613458 * $a - 0.0638541728 * $b ) ** 3;
		$s = ( $capital_l - 0.0894841775 * $a - 1.2914855480 * $b ) ** 3;

		$out = array(
			4.0767416621 * $l - 3.3077115913 * $m + 0.2309699292 * $s,
			-1.2684380046 * $l + 2.6097574011 * $m - 0.3413193965 * $s,
			-0.0041960863 * $l - 0.7034186147 * $m + 1.7076147010 * $s,
		);

		foreach ( $out as $i => $v ) {
			$v         = $v <= 0.0031308 ? 12.92 * $v : 1.055 * max( $v, 0.0 ) ** ( 1 / 2.4 ) - 0.055;
			$out[ $i ] = (int) max( 0, min( 255, (int) round( $v * 255.0 ) ) );
		}
		return $out;
	}

	/** The hexadecimal a stylesheet can use, lower case, always six digits. */
	public static function hex( array $lab ): string {
		list( $r, $g, $b ) = self::srgb( $lab );
		return sprintf( '#%02x%02x%02x', $r, $g, $b );
	}

	/**
	 * A hexadecimal the maker declares, read into OKLab. Null when it is not one.
	 *
	 * THE ROUND TRIP IS EXACT, AND THAT WAS MEASURED, not assumed. All
	 * 16 777 216 sRGB colours were pushed through `oklab()` and back through
	 * `srgb()`: zero of them came back different, on PHP 8.3, in 40 s. So a
	 * declared colour survives being stored as OKLab and drawn again bit for
	 * bit, which is what lets `scripts/couleurs-guard.mjs` demand that every
	 * published swatch equal what its own stored triple converts to. Without
	 * that property the declared road would have to keep the maker's string
	 * beside the measurement, which is a second copy of one value.
	 *
	 * THE SHAPE IS CHECKED HERE, not at the call site, because the value comes
	 * out of the database. `Supply::hex()` normalises it at import, and nothing
	 * stops a hand or another plugin writing something else on the row
	 * afterwards. Six digits and a croisillon, or nothing: a three-digit form
	 * would be repaired by guessing, and a guessed colour is the defect this
	 * whole file exists to remove.
	 *
	 * @return array{0:float,1:float,2:float}|null
	 */
	public static function from_hex( string $raw ): ?array {
		$raw = trim( $raw );
		if ( 1 !== preg_match( '/^#[0-9a-fA-F]{6}$/', $raw ) ) {
			return null;
		}
		$n = (int) hexdec( substr( $raw, 1 ) );
		return self::oklab( ( $n >> 16 ) & 255, ( $n >> 8 ) & 255, $n & 255 );
	}

	/**
	 * One colour name, from the hexadecimals its maker declares for it.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * A DECLARATION IS A MEASUREMENT WITH THE MEASUREMENT ERROR REMOVED.
	 *
	 * The file header argues that the maker's chip is the declared colour,
	 * delivered as an image, and that the photograph is the check. A numeric
	 * declaration is that same statement with the JPEG, the lamp and the
	 * segmentation taken out of it. It is therefore the best of the three
	 * sources, not a shortcut past them, and it is tried first.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * ONE NAME CAN CARRY SEVERAL DECLARATIONS, AND THAT IS NOT A BUG.
	 *
	 * MEASURED on the supplier's full catalogue, 9 September 2026: 1 892 colour
	 * names, of which 63 carry MORE than one hexadecimal across brands, and
	 * « BLACK » carries six. The shop keeps one term per name, so those six
	 * arrive here together. Averaging them blindly would invent a colour nobody
	 * declared; refusing on the first disagreement would drop a name over one
	 * brand's outlier.
	 *
	 * So they go through `aggregate()`, exactly as several photographs of one
	 * colourway do: the median decides, a declaration further than `AGREE_MAX`
	 * from it is dropped, and a name whose declarations have no majority is
	 * refused with the spread on the record. ONE rule for « what colour is
	 * this », now three ways of bringing it values.
	 *
	 * `AGREE_MAX` IS BORROWED, AND A REFUSAL HERE COSTS NOTHING. It was fitted
	 * on photographs of one colourway, not on declarations from two brands, and
	 * nothing has been measured that would set it for this road. What makes that
	 * acceptable is where a refusal LEADS: `Colours::sweep()` then falls through
	 * to the chip and to the garment photograph, which are measurements of the
	 * real dye. The bar being wrong costs a fetch, never an invented colour.
	 *
	 * MEASURED on the local mirror, 9 September 2026: 14 colour names carry two
	 * declarations, 12 are published and 2 refused (« Fuchsia » at 0,124 and
	 * « Sky » at 0,131), and all 14 have BOTH declarations inside one family, so
	 * no reference changes aisle over this.
	 *
	 * AT TWO VALUES THERE IS NO OUTLIER TO DROP. The median of two is their
	 * midpoint and each sits at half their distance from it, so a pair passes up
	 * to TWICE `AGREE_MAX` and the published colour is a midpoint neither brand
	 * declared. That is the same arithmetic two photographs have always had; it
	 * is written down because it surprises.
	 *
	 * @param string[] $hexes The maker's declarations, deduplicated by the caller.
	 */
	public static function declared( array $hexes ): array {
		$labs      = array();
		$unusable  = 0;
		foreach ( $hexes as $raw ) {
			$lab = self::from_hex( (string) $raw );
			if ( null === $lab ) {
				++$unusable;
				continue;
			}
			$labs[] = $lab;
		}

		if ( array() === $labs ) {
			/*
			 * « Nothing was declared » and « what was declared is not a colour »
			 * send an operator to two different places: the first to the
			 * supplier's payload, the second to whatever wrote the row.
			 */
			return array_merge(
				self::nothing( 0 === $unusable ? 'aucune teinte déclarée' : 'teinte déclarée illisible' ),
				array( 'seen' => $unusable )
			);
		}

		$out = self::aggregate(
			array_map(
				static fn( array $lab ): array => array(
					'ok'      => true,
					'why'     => '',
					'stops'   => array( $lab ),
					'share'   => 1.0,
					'scatter' => 0.0,
				),
				$labs
			)
		);

		if ( empty( $out['ok'] ) ) {
			/*
			 * Every entry handed to `aggregate()` above is a good one, so its
			 * only remaining refusal is « they do not agree ». Said in the words
			 * of THIS source: « photos discordantes » on a colour measured from
			 * no photograph at all would send the reader looking for images.
			 */
			$out['why'] = sprintf(
				'teintes déclarées discordantes (%d, écart %s)',
				count( $labs ),
				number_format( (float) ( $out['spread'] ?? 0.0 ), 3, ',', '' )
			);
		}
		return $out;
	}

	/**
	 * Lightness, chroma and hue in degrees.
	 *
	 * @param array{0:float,1:float,2:float} $lab
	 * @return array{0:float,1:float,2:float} L, C, h
	 */
	public static function oklch( array $lab ): array {
		list( $capital_l, $a, $b ) = $lab;
		return array(
			$capital_l,
			sqrt( $a * $a + $b * $b ),
			fmod( rad2deg( atan2( $b, $a ) ) + 360.0, 360.0 ),
		);
	}

	/** Euclidean distance in OKLab, which is what the space is built for. */
	public static function delta( array $one, array $two ): float {
		return sqrt(
			( $one[0] - $two[0] ) ** 2 +
			( $one[1] - $two[1] ) ** 2 +
			( $one[2] - $two[2] ) ** 2
		);
	}

	// ══════════════════════════════════════════════════════ classification ══

	/**
	 * The eleven families, in the order the filter shows them.
	 *
	 * Ordered as a buyer scans rather than alphabetically: the neutrals first
	 * because that is what most workwear orders are, then the circle.
	 *
	 * @return array<string,string> slug => the French heading
	 */
	public static function families(): array {
		return array(
			'blanc'  => 'Blancs et écrus',
			'gris'   => 'Gris',
			'noir'   => 'Noirs',
			'brun'   => 'Beiges et bruns',
			'rouge'  => 'Rouges',
			'rose'   => 'Roses',
			'orange' => 'Oranges',
			'jaune'  => 'Jaunes',
			'vert'   => 'Verts',
			'bleu'   => 'Bleus',
			'violet' => 'Violets',
		);
	}

	/**
	 * How much colour there is, on the one scale both thresholds read.
	 */
	public static function saturation( float $capital_l, float $c ): float {
		return $c / max( $capital_l, self::L_SAT );
	}

	/**
	 * Which family a measured colour belongs to.
	 *
	 * @param array{0:float,1:float,2:float} $lab
	 */
	public static function family( array $lab ): string {
		list( $capital_l, $c, $h ) = self::oklch( $lab );

		$s = self::saturation( $capital_l, $c );

		// ── stage 1: is there a colour here at all ──────────────────────────
		if ( $s < self::S_NEUTRE ) {
			if ( $capital_l >= self::L_CLAIR ) {
				return 'blanc';
			}
			return $capital_l <= self::L_SOMBRE ? 'noir' : 'gris';
		}

		// ── stage 2: the warm arc, where lightness and chroma decide ────────
		if ( $h >= self::H_TERRE_MIN && $h < self::H_TERRE_MAX ) {
			/*
			 * Washed out at any lightness, or dark and no more than moderately
			 * saturated. Bordeaux is rgb(128,0,32): warm and dark like a brown,
			 * but at C=0,152 it is over the chroma bound and stays a red, which
			 * is what the first version of this rule got wrong for every dark
			 * red in the catalogue.
			 */
			$earthy = ( $c < self::C_TERNE && $capital_l < self::L_CLAIR )
				|| ( $capital_l < self::L_TERRE && $c < self::C_TERRE );
			if ( $earthy ) {
				if ( $h < self::H_TERRE_SPLIT ) {
					return 'brun';
				}
				// Past the split it is the yellow arc: dark reads as kaki and
				// belongs with the greens, pale reads as a cream and does not.
				return $capital_l < self::L_TERRE ? 'vert' : 'brun';
			}
		}

		// ── stage 3: pink, which is a light red ─────────────────────────────
		if ( $capital_l >= self::L_ROSE && ( $h >= self::H_MAGENTA || $h < self::H_ROSE ) ) {
			return 'rose';
		}

		// ── stage 4: the rest, by hue ───────────────────────────────────────
		foreach ( self::ARCS as list( $upper, $family ) ) {
			if ( $h < $upper ) {
				return $family;
			}
		}
		return 'rouge';
	}

	/**
	 * The family a colour is PUBLISHED under: the measurement, then the tie-break.
	 *
	 * The one home for the rule. `verify()` calls it and so does
	 * `scripts/couleurs-guard.mjs`, through PHP, over every row of the committed
	 * record: a guard that recomputed only `family()` would flag every colour the
	 * tie-break moved, and a guard that reimplemented the tie-break would be a
	 * second copy of it.
	 *
	 * @param array{0:float,1:float,2:float} $lab
	 */
	public static function family_for( array $lab, string $name ): string {
		$measured = self::family( $lab );

		$claims = self::name_families( $name );
		if ( 1 !== count( $claims ) || $claims[0] === $measured ) {
			return $measured;
		}

		list( $capital_l, $c ) = self::oklch( $lab );

		return self::saturation( $capital_l, $c ) < self::S_FLOU ? $claims[0] : $measured;
	}

	/**
	 * What the supplier's own words claim, used ONLY to check the measurement.
	 *
	 * This is not a second classifier and it never decides a family. It is an
	 * independent signal: when the photograph says green and the label says
	 * « Navy », one of the two is wrong and we cannot tell which, so `Colours`
	 * publishes neither. Silence is the only honest output of a contradiction.
	 *
	 * Only unambiguous words are listed. « Sage », « Atoll » and « Iron » say
	 * nothing checkable and return '', which is a pass, not a failure: an
	 * unverifiable name leaves the measurement standing on its own. (« Mocha »
	 * used to be in that sentence and is not unverifiable at all: « moka » is in
	 * the brown list twelve lines below and the name resolves.)
	 *
	 * WHAT THE MATCHING ACTUALLY DOES: the name is lower-cased, the three
	 * separators this catalogue uses are turned into spaces, and each listed
	 * word is looked for as a WHOLE word. Every hit is collected, so a name may
	 * claim two families; the order of the list does not decide anything, it
	 * only keeps the longer phrases (« Light Grey Marl », « Bottle Green »)
	 * findable before their own shorter substrings.
	 */
	public static function name_families( string $name ): array {
		$n = ' ' . strtolower( trim( $name ) ) . ' ';
		$n = strtr( $n, array( '/' => ' ', '-' => ' ', ',' => ' ' ) );

		/*
		 * ONLY WORDS NOBODY ARGUES ABOUT ARE IN HERE, and the list got shorter
		 * once it met the catalogue. « Turquoise », « Aqua », « Teal » and
		 * « Petrol » sit between the greens and the blues; « Coral », « Salmon »
		 * and « Peach » between the pinks and the oranges; « Rust » and
		 * « Terracotta » between the browns and the oranges; « Taupe » and
		 * « Slate » between the greys and everything; « Natural » and « Cream »
		 * between the whites and the beiges. Every one of them was refusing a
		 * perfectly good measurement for disagreeing with a word that has no
		 * single right answer. A check that fires on an opinion is not a check.
		 */
		$words = array(
			'blanc'  => array( 'white', 'blanc', 'blanche', 'snowwhite', 'ecru', 'écru', 'ivory', 'ivoire' ),
			'noir'   => array( 'black', 'noir', 'noire' ),
			'gris'   => array( 'grey', 'gray', 'gris', 'charcoal', 'anthracite', 'silver', 'argent', 'graphite', 'ash', 'asphalt', 'oxford' ),
			'brun'   => array( 'brown', 'brun', 'marron', 'beige', 'sand', 'sable', 'camel', 'chocolate', 'chocolat', 'coffee', 'café', 'mocha', 'moka', 'caramel', 'biscuit', 'walnut' ),
			'rouge'  => array( 'red', 'rouge', 'burgundy', 'bordeaux', 'wine', 'crimson', 'scarlet', 'cherry', 'cerise' ),
			'rose'   => array( 'pink', 'rose', 'fuchsia', 'magenta', 'raspberry', 'framboise' ),
			'orange' => array( 'orange', 'apricot', 'abricot', 'tangerine' ),
			'jaune'  => array( 'yellow', 'jaune', 'lemon', 'citron', 'mustard', 'moutarde', 'maize' ),
			'vert'   => array( 'green', 'vert', 'verte', 'olive', 'khaki', 'kaki', 'lime', 'mint', 'menthe', 'emerald', 'émeraude', 'jade', 'forest', 'bottle', 'moss', 'pistachio', 'army', 'military' ),
			'bleu'   => array( 'blue', 'bleu', 'navy', 'marine', 'royal', 'azure', 'azur', 'cobalt', 'denim', 'indigo', 'sapphire', 'saphir', 'sky', 'ciel' ),
			'violet' => array( 'purple', 'violet', 'lilac', 'lilas', 'lavender', 'lavande', 'aubergine', 'amethyst' ),
		);

		$hits = array();
		foreach ( $words as $family => $list ) {
			foreach ( $list as $word ) {
				if ( str_contains( $n, ' ' . $word . ' ' ) ) {
					$hits[] = $family;
					break;
				}
			}
		}
		return $hits;
	}

	/** The single family the name claims, or '' when it claims none or several. */
	public static function name_family( string $name ): string {
		$hits = self::name_families( $name );
		return 1 === count( $hits ) ? $hits[0] : '';
	}

	// ═══════════════════════════════════════════════════════ measurement ══

	/**
	 * Measure one photograph.
	 *
	 * @param int[] $pixels Packed 0xRRGGBB, row major, exactly $w * $h of them.
	 * @return array{ok:bool,why:string,stops:array<int,array{0:float,1:float,2:float}>,share:float,scatter:float}
	 */
	public static function measure( array $pixels, int $w, int $h ): array {
		$total = $w * $h;
		if ( $w < 8 || $h < 8 || count( $pixels ) !== $total ) {
			return self::refused( 'image illisible' );
		}

		$r = array();
		$g = array();
		$b = array();
		foreach ( $pixels as $i => $p ) {
			$r[ $i ] = ( $p >> 16 ) & 255;
			$g[ $i ] = ( $p >> 8 ) & 255;
			$b[ $i ] = $p & 255;
		}

		// ── the ground, from the border ring ────────────────────────────────
		$ring = array();
		for ( $y = 0; $y < $h; $y++ ) {
			for ( $x = 0; $x < $w; $x++ ) {
				if ( $x < self::RING || $y < self::RING || $x >= $w - self::RING || $y >= $h - self::RING ) {
					$ring[] = $y * $w + $x;
				}
			}
		}
		$bg = array(
			self::median( array_map( static fn( $i ) => (float) $r[ $i ], $ring ) ),
			self::median( array_map( static fn( $i ) => (float) $g[ $i ], $ring ) ),
			self::median( array_map( static fn( $i ) => (float) $b[ $i ], $ring ) ),
		);

		$off = array();
		foreach ( $ring as $i ) {
			$off[] = sqrt( ( $r[ $i ] - $bg[0] ) ** 2 + ( $g[ $i ] - $bg[1] ) ** 2 + ( $b[ $i ] - $bg[2] ) ** 2 );
		}
		if ( self::quantile( $off, 0.90 ) > self::RING_MAX ) {
			return self::refused( 'fond non uniforme' );
		}

		/*
		 * ── the ground, flood filled from the border ──────────────────────
		 *
		 * CONNECTED, not thresholded, and that is the whole trick. A white
		 * t-shirt photographed on a white ground defeats every threshold: its
		 * own highlights ARE the ground colour. But they are surrounded by
		 * shirt, so a fill that can only enter from the frame's edge never
		 * reaches them. Verified by eye on the fourteen masks, white included.
		 */
		$isbg  = array_fill( 0, $total, false );
		$stack = array();
		for ( $y = 0; $y < $h; $y++ ) {
			for ( $x = 0; $x < $w; $x++ ) {
				if ( 0 !== $x && 0 !== $y && $w - 1 !== $x && $h - 1 !== $y ) {
					continue;
				}
				$i = $y * $w + $x;
				if ( $isbg[ $i ] ) {
					continue;
				}
				if ( self::near( $r[ $i ], $g[ $i ], $b[ $i ], $bg ) ) {
					$isbg[ $i ] = true;
					$stack[]    = $i;
				}
			}
		}
		while ( $stack ) {
			$i = array_pop( $stack );
			$x = $i % $w;
			$y = intdiv( $i, $w );
			foreach ( array( array( 1, 0 ), array( -1, 0 ), array( 0, 1 ), array( 0, -1 ) ) as $step ) {
				$nx = $x + $step[0];
				$ny = $y + $step[1];
				if ( $nx < 0 || $ny < 0 || $nx >= $w || $ny >= $h ) {
					continue;
				}
				$j = $ny * $w + $nx;
				if ( $isbg[ $j ] || ! self::near( $r[ $j ], $g[ $j ], $b[ $j ], $bg ) ) {
					continue;
				}
				$isbg[ $j ] = true;
				$stack[]    = $j;
			}
		}

		// ── erode, because a downscaled edge pixel is half ground ──────────
		$fg     = array();
		$ground = 0;
		for ( $i = 0; $i < $total; $i++ ) {
			$fg[ $i ] = ! $isbg[ $i ];
			if ( $isbg[ $i ] ) {
				++$ground;
			}
		}
		for ( $pass = 0; $pass < self::ERODE; $pass++ ) {
			$next = $fg;
			for ( $y = 0; $y < $h; $y++ ) {
				for ( $x = 0; $x < $w; $x++ ) {
					$i = $y * $w + $x;
					if ( ! $fg[ $i ] ) {
						continue;
					}
					if ( 0 === $x || 0 === $y || $w - 1 === $x || $h - 1 === $y
						|| ! $fg[ $i - 1 ] || ! $fg[ $i + 1 ] || ! $fg[ $i - $w ] || ! $fg[ $i + $w ] ) {
						$next[ $i ] = false;
					}
				}
			}
			$fg = $next;
		}

		$lab = array();
		foreach ( $fg as $i => $keep ) {
			if ( $keep ) {
				$lab[] = self::oklab( $r[ $i ], $g[ $i ], $b[ $i ] );
			}
		}
		$share = count( $lab ) / $total;
		if ( $ground / $total < self::GROUND_MIN ) {
			// Asked before the erosion, because the erosion removes foreground
			// and would make every frame look as though it had more ground.
			return self::refused( 'aucun fond détecté' );
		}
		if ( $share < self::MIN_FRAC ) {
			return self::refused( 'sujet absent ou trop petit' );
		}

		return self::stops( $lab, $share, true );
	}

	/**
	 * Measure a colour chip.
	 *
	 * It shares `stops()` with the photograph, which is the whole point: there
	 * is ONE rule for « what colour is this », the marginal median in OKLab, and
	 * two ways of getting pixels to it. A chip that is split down the middle,
	 * which is how a two-tone colourway is shipped, comes out of the same
	 * clustering as a raglan photographed from the front.
	 *
	 * @param int[] $pixels Packed 0xRRGGBB, row major.
	 * @return array the same shape `measure()` returns.
	 */
	public static function chip( array $pixels, int $w, int $h ): array {
		if ( $w < 8 || $h < 8 || count( $pixels ) !== $w * $h ) {
			return self::refused( 'image illisible' );
		}

		$lab = array();
		foreach ( $pixels as $p ) {
			$lab[] = self::oklab( ( $p >> 16 ) & 255, ( $p >> 8 ) & 255, $p & 255 );
		}

		$out = self::stops( $lab, 1.0 );
		$iw  = $w;
		$ih  = $h;

		// How much of the frame sits on the colour or colours just found, and
		// how the border ring is shared out between them.
		$near   = 0;
		$ring   = array_fill( 0, count( $out['stops'] ), 0 );
		$border = 0;
		foreach ( $lab as $i => $p ) {
			$best = 0;
			$dist = INF;
			foreach ( $out['stops'] as $k => $stop ) {
				$d = self::delta( $p, $stop );
				if ( $d < $dist ) {
					$dist = $d;
					$best = $k;
				}
			}
			if ( $dist <= self::CHIP_NEAR ) {
				++$near;
			}
			$x = $i % $iw;
			$y = intdiv( $i, $iw );
			if ( 0 === $x || 0 === $y || $iw - 1 === $x || $ih - 1 === $y ) {
				++$border;
				++$ring[ $best ];
			}
		}

		$flat = $near / count( $lab );
		if ( $flat < self::CHIP_FLAT ) {
			return self::refused( 'la pastille fournisseur n’est pas une teinte unie' );
		}

		if ( count( $out['stops'] ) > 1 && $border > 0 && min( $ring ) / $border < self::BORD_MIN ) {
			return self::refused( 'ce n’est pas une pastille, c’est un vêtement détouré' );
		}

		$out['share'] = $flat;
		return $out;
	}

	/** True when this pixel is within TAU of the ground colour. */
	private static function near( int $r, int $g, int $b, array $bg ): bool {
		return ( ( $r - $bg[0] ) ** 2 + ( $g - $bg[1] ) ** 2 + ( $b - $bg[2] ) ** 2 ) <= self::TAU ** 2;
	}

	/**
	 * One colour, or two.
	 *
	 * @param array<int,array{0:float,1:float,2:float}> $lab
	 */
	private static function stops( array $lab, float $share, bool $lit = false ): array {
		$one = self::centre( $lab );

		list( $a_set, $b_set ) = self::split( $lab );
		$scatter               = self::scatter( $lab, $one );

		if ( ! empty( $a_set ) && ! empty( $b_set ) ) {
			$ca    = self::centre( $a_set );
			$cb    = self::centre( $b_set );
			$sep   = self::delta( $ca, $cb );
			$minor = min( count( $a_set ), count( $b_set ) ) / count( $lab );
			$in    = ( self::scatter( $a_set, $ca ) * count( $a_set ) + self::scatter( $b_set, $cb ) * count( $b_set ) ) / count( $lab );
			$gap   = self::gap( $lab, $ca, $cb );

			$shadow = $lit && self::same_dye( $ca, $cb );

			if ( $sep >= self::SEP_MIN && $minor >= self::MINOR_MIN && $gap <= self::GAP_MAX && ! $shadow ) {
				// Larger first: the swatch reads primary then secondary, and a
				// raglan is named for its body, not for its sleeves.
				$stops = count( $a_set ) >= count( $b_set ) ? array( $ca, $cb ) : array( $cb, $ca );
				return array(
					'ok'      => true,
					'why'     => '',
					'stops'   => $stops,
					'share'   => $share,
					'scatter' => $in,
				);
			}
		}

		return array(
			'ok'      => true,
			'why'     => '',
			'stops'   => array( $one ),
			'share'   => $share,
			'scatter' => $scatter,
		);
	}

	/**
	 * Two centres that are one dye under two lights, rather than two dyes.
	 *
	 * See H_LUM above for why hue and C/L are the invariants and where the two
	 * bounds come from.
	 *
	 * @param array{0:float,1:float,2:float} $ca
	 * @param array{0:float,1:float,2:float} $cb
	 */
	private static function same_dye( array $ca, array $cb ): bool {
		list( $la, $chroma_a, $ha ) = self::oklch( $ca );
		list( $lb, $chroma_b, $hb ) = self::oklch( $cb );

		$dh = abs( $ha - $hb );
		if ( $dh > 180.0 ) {
			$dh = 360.0 - $dh;
		}

		return $dh <= self::H_LUM
			&& abs( self::saturation( $la, $chroma_a ) - self::saturation( $lb, $chroma_b ) ) <= self::S_LUM;
	}

	/**
	 * What share of the pixels lies in the middle third between two centres.
	 *
	 * Each pixel is projected onto the line joining them and read as a position
	 * from 0 to 1, and the middle THIRD is counted. Two dyes leave it empty; one
	 * dye unevenly lit fills it with a third of itself. That is the whole
	 * difference between « Navy/White » and a shadow.
	 *
	 * @param array<int,array{0:float,1:float,2:float}> $lab
	 */
	private static function gap( array $lab, array $ca, array $cb ): float {
		$axis = array( $cb[0] - $ca[0], $cb[1] - $ca[1], $cb[2] - $ca[2] );
		$len2 = $axis[0] ** 2 + $axis[1] ** 2 + $axis[2] ** 2;
		if ( $len2 < 1e-12 ) {
			return 1.0;
		}

		$middle = 0;
		foreach ( $lab as $p ) {
			$t = ( ( $p[0] - $ca[0] ) * $axis[0] + ( $p[1] - $ca[1] ) * $axis[1] + ( $p[2] - $ca[2] ) * $axis[2] ) / $len2;
			if ( $t >= 1 / 3 && $t <= 2 / 3 ) {
				++$middle;
			}
		}
		return $middle / count( $lab );
	}

	/**
	 * Two clusters, k-means, deterministic.
	 *
	 * Seeded on the axis of greatest variance rather than on lightness, because
	 * « Grey/Lime » differs in chroma and « Black/White » differs in lightness,
	 * and a lightness seed would find the shadow rather than the second colour.
	 * No randomness anywhere: the same photograph must measure the same on
	 * every machine and in every re-run, or the ledger is worthless.
	 *
	 * @param array<int,array{0:float,1:float,2:float}> $lab
	 * @return array{0:array,1:array}
	 */
	private static function split( array $lab ): array {
		$var  = array( 0.0, 0.0, 0.0 );
		$mean = self::mean( $lab );
		foreach ( $lab as $p ) {
			for ( $k = 0; $k < 3; $k++ ) {
				$var[ $k ] += ( $p[ $k ] - $mean[ $k ] ) ** 2;
			}
		}
		$axis = 0;
		for ( $k = 1; $k < 3; $k++ ) {
			if ( $var[ $k ] > $var[ $axis ] ) {
				$axis = $k;
			}
		}

		$along = array_map( static fn( $p ) => $p[ $axis ], $lab );
		$lo    = self::quantile( $along, self::SEED_LO );
		$hi    = self::quantile( $along, self::SEED_HI );
		if ( $hi - $lo < 1e-9 ) {
			return array( $lab, array() );
		}

		$ca = self::centre( array_values( array_filter( $lab, static fn( $p ) => $p[ $axis ] <= $lo ) ) ?: array( $lab[0] ) );
		$cb = self::centre( array_values( array_filter( $lab, static fn( $p ) => $p[ $axis ] >= $hi ) ) ?: array( $lab[0] ) );

		$a = array();
		$b = array();
		for ( $round = 0; $round < self::KMEANS_ROUNDS; $round++ ) {
			$a = array();
			$b = array();
			foreach ( $lab as $p ) {
				if ( self::delta( $p, $ca ) <= self::delta( $p, $cb ) ) {
					$a[] = $p;
				} else {
					$b[] = $p;
				}
			}
			if ( empty( $a ) || empty( $b ) ) {
				return array( $lab, array() );
			}
			$na = self::mean( $a );
			$nb = self::mean( $b );
			if ( self::delta( $na, $ca ) < 1e-5 && self::delta( $nb, $cb ) < 1e-5 ) {
				$ca = $na;
				$cb = $nb;
				break;
			}
			$ca = $na;
			$cb = $nb;
		}
		return array( $a, $b );
	}

	/**
	 * The colour of a set of pixels: the marginal median.
	 *
	 * The median and not the mean, because a photograph of a garment contains
	 * a specular highlight on one shoulder, a shadow under the other and a
	 * printed neck label, and the mean is pulled by all three. The median is
	 * the pixel half the garment is lighter than, which is what a person means
	 * by « the colour of that shirt ».
	 *
	 * @param array<int,array{0:float,1:float,2:float}> $lab
	 * @return array{0:float,1:float,2:float}
	 */
	public static function centre( array $lab ): array {
		if ( empty( $lab ) ) {
			return array( 0.0, 0.0, 0.0 );
		}
		return array(
			self::median( array_column( $lab, 0 ) ),
			self::median( array_column( $lab, 1 ) ),
			self::median( array_column( $lab, 2 ) ),
		);
	}

	/** @param array<int,array{0:float,1:float,2:float}> $lab */
	private static function mean( array $lab ): array {
		$n = count( $lab );
		if ( 0 === $n ) {
			return array( 0.0, 0.0, 0.0 );
		}
		$sum = array( 0.0, 0.0, 0.0 );
		foreach ( $lab as $p ) {
			$sum[0] += $p[0];
			$sum[1] += $p[1];
			$sum[2] += $p[2];
		}
		return array( $sum[0] / $n, $sum[1] / $n, $sum[2] / $n );
	}

	/** Mean distance from a centre: how spread out a set of pixels is. */
	private static function scatter( array $lab, array $centre ): float {
		if ( empty( $lab ) ) {
			return 0.0;
		}
		$sum = 0.0;
		foreach ( $lab as $p ) {
			$sum += self::delta( $p, $centre );
		}
		return $sum / count( $lab );
	}

	// ═══════════════════════════════════════════════════════ aggregation ══

	/**
	 * One colour name, from every photograph that carries it.
	 *
	 * @param array<int,array> $photos results of `measure()`, in a stable order.
	 * @return array{ok:bool,why:string,stops:array<int,string>,lab:array,family:string,photos:int,seen:int,spread:float}
	 */
	public static function aggregate( array $photos ): array {
		$good = array_values( array_filter( $photos, static fn( $p ) => ! empty( $p['ok'] ) ) );
		$seen = count( $photos );

		if ( empty( $good ) ) {
			// Report the reason the photographs actually gave, not a generic
			// one: « fond non uniforme » and « image illisible » send whoever
			// reads the state command to two different places.
			$why = array();
			foreach ( $photos as $p ) {
				$reason         = (string) ( $p['why'] ?? 'aucune photo' );
				$why[ $reason ] = ( $why[ $reason ] ?? 0 ) + 1;
			}
			arsort( $why );
			$out = self::nothing( $seen ? (string) array_key_first( $why ) : 'aucune photo' );

			/*
			 * « WE COULD NOT LOOK » IS NOT « THERE IS NO COLOUR ».
			 *
			 * A refusal is a measurement: this image was read and it does not
			 * yield a colour. An unreachable image is not. They arrive here in
			 * the same shape and only this flag keeps them apart, so that a
			 * Worker outage cannot be stored as a colour's verdict and then
			 * skipped for ever by the next sweep.
			 */
			$out['reachable'] = false;
			foreach ( $photos as $p ) {
				if ( false !== ( $p['reachable'] ?? true ) ) {
					$out['reachable'] = true;
				}
			}
			return $out;
		}

		/*
		 * TWO-TONE IS A MAJORITY DECISION, not a first-photo one. A raglan
		 * shot from the front shows both colours; the same colourway on a cap
		 * may show one. Whichever most photographs saw is what the name is.
		 */
		$two = array_values( array_filter( $good, static fn( $p ) => count( $p['stops'] ) > 1 ) );
		$use = count( $two ) * 2 > count( $good ) ? $two : $good;

		$primary = array_map( static fn( $p ) => $p['stops'][0], $use );
		$lab     = self::centre( $primary );

		/*
		 * Drop the photographs that disagree with the rest, then re-centre on
		 * the ones that are left. The median is already robust to one outlier
		 * in five; this is about the SPREAD figure, which is what tells an
		 * operator whether a swatch is trustworthy, and about the case where
		 * one name really does cover two dyes.
		 */
		$kept = array();
		foreach ( $use as $i => $photo ) {
			if ( self::delta( $primary[ $i ], $lab ) <= self::AGREE_MAX ) {
				$kept[] = $photo;
			}
		}
		/*
		 * EMPTY IS A REFUSAL, NOT AN AVERAGE. With no survivors `centre()`
		 * answers (0,0,0), which is black, and a colour name would be published
		 * as black for having disagreed with itself. It cannot happen today (a
		 * single image is always zero from its own median) and it is written
		 * anyway, because what it costs is a comparison and what it would cost
		 * to be wrong is a black swatch on « Fluo Yellow ».
		 */
		if ( empty( $kept ) || ( count( $kept ) * 2 <= count( $use ) && count( $use ) > 1 ) ) {
			// No majority agrees with anything: the name covers two dyes.
			$worst = 0.0;
			foreach ( $primary as $p ) {
				$worst = max( $worst, self::delta( $p, $lab ) );
			}
			return array_merge( self::nothing( 'photos discordantes' ), array( 'seen' => $seen, 'spread' => $worst ) );
		}

		$use     = $kept;
		$two     = array_values( array_filter( $use, static fn( $p ) => count( $p['stops'] ) > 1 ) );
		$primary = array_map( static fn( $p ) => $p['stops'][0], $use );
		$lab     = self::centre( $primary );

		$spread = 0.0;
		foreach ( $primary as $p ) {
			$spread = max( $spread, self::delta( $p, $lab ) );
		}

		$stops = array( self::hex( $lab ) );
		$labs  = array( $lab );
		if ( count( $two ) * 2 > count( $use ) ) {
			$second  = self::centre( array_map( static fn( $p ) => $p['stops'][1], $two ) );
			$stops[] = self::hex( $second );
			$labs[]  = $second;
		}

		return array(
			'ok'     => true,
			'why'    => '',
			'stops'  => $stops,
			'lab'    => $lab,
			'labs'   => $labs,
			'family' => self::family( $lab ),
			'photos' => count( $use ),
			'seen'   => $seen,
			'spread' => $spread,
		);
	}

	/**
	 * The last gate: does the photograph agree with the label on the garment?
	 *
	 * The measurement stands on its own everywhere except here. `name_family()`
	 * reads the supplier's own word for the colour, and when that word names
	 * exactly one family and the photograph names another, ONE OF THE TWO IS
	 * WRONG AND WE CANNOT TELL WHICH. It might be a colourway photographed in
	 * the wrong colour, a name copied from the row above, or a boundary in this
	 * file set half a degree off. All three are real and all three end the same
	 * way: no swatch, and the disagreement on the record.
	 *
	 * Publishing the measurement anyway would put a green dot next to
	 * « Navy » on a filter a buyer uses to choose. Publishing the name's family
	 * instead would be worse: it would hide a broken photograph for ever.
	 *
	 * @param array  $agg  what `aggregate()` returned.
	 * @param string $name the supplier's colour name.
	 */
	public static function verify( array $agg, string $name ): array {
		if ( empty( $agg['ok'] ) ) {
			return $agg;
		}

		$claims = self::name_families( $name );
		if ( empty( $claims ) ) {
			$agg['claimed'] = '';
			return $agg;
		}

		$agg['family'] = self::family_for( $agg['lab'], $name );

		/*
		 * THE CHECK HAS TWO HALVES, AND IT NEEDS BOTH.
		 *
		 * EVERY FAMILY THE NAME NAMES MUST HAVE BEEN SEEN. « Black/Dolphin » is
		 * a two-tone chip measuring black and grey, and the label names one
		 * family because « Dolphin » is not a word this file knows. Demanding
		 * that every measured tone be NAMED refused nine perfectly good
		 * measurements for being more complete than their labels.
		 *
		 * AND EVERY STRONG COLOUR SEEN MUST HAVE BEEN NAMED. Only that way
		 * round, a chip that is black and bright red would pass as
		 * « Black/Dolphin », because the red half is simply unnamed. A washed
		 * out half nobody named is a label being terse; a saturated half nobody
		 * named is a chip that does not match its label.
		 */
		$labs = (array) ( $agg['labs'] ?? array( $agg['lab'] ) );
		$saw  = array();
		$loud = array();
		foreach ( $labs as $lab ) {
			$saw[] = self::family_for( $lab, $name );

			list( $capital_l, $c ) = self::oklch( $lab );
			if ( self::saturation( $capital_l, $c ) >= self::S_FLOU ) {
				$loud[] = self::family( $lab );
			}
		}
		if ( empty( array_diff( $claims, $saw ) ) && empty( array_diff( $loud, $claims ) ) ) {
			$agg['claimed'] = implode( '+', array_unique( $claims ) );
			return $agg;
		}

		return array(
			'ok'      => false,
			'why'     => 'la photo dit « ' . implode( '+', array_unique( $saw ) ) . ' », le nom dit « ' . implode( '+', array_unique( $claims ) ) . ' »',
			'stops'   => array(),
			'lab'     => $agg['lab'],
			'labs'    => (array) ( $agg['labs'] ?? array() ),
			'family'  => '',
			'claimed' => implode( '+', array_unique( $claims ) ),
			'saw'     => implode( '+', array_unique( $saw ) ),
			'photos'  => (int) ( $agg['photos'] ?? 0 ),
			'seen'    => (int) ( $agg['seen'] ?? 0 ),
			'spread'  => (float) ( $agg['spread'] ?? 0.0 ),
		);
	}

	/** A refusal, with the three states kept apart: yes, no, could not look. */
	private static function refused( string $why ): array {
		return array(
			'ok'      => false,
			'why'     => $why,
			'stops'   => array(),
			'share'   => 0.0,
			'scatter' => 0.0,
		);
	}

	/** @return array{ok:bool,why:string,stops:array,lab:array,family:string,photos:int,seen:int,spread:float} */
	private static function nothing( string $why ): array {
		return array(
			'ok'     => false,
			'why'    => $why,
			'stops'  => array(),
			'lab'    => array(),
			'family' => '',
			'photos' => 0,
			'seen'   => 0,
			'spread' => 0.0,
		);
	}

	// ══════════════════════════════════════════════════════════════ maths ══

	/** @param float[] $v */
	public static function median( array $v ): float {
		sort( $v );
		$n = count( $v );
		if ( 0 === $n ) {
			return 0.0;
		}
		return 0 === $n % 2 ? ( $v[ intdiv( $n, 2 ) - 1 ] + $v[ intdiv( $n, 2 ) ] ) / 2.0 : $v[ intdiv( $n, 2 ) ];
	}

	/** @param float[] $v */
	private static function quantile( array $v, float $p ): float {
		sort( $v );
		$n = count( $v );
		if ( 0 === $n ) {
			return 0.0;
		}
		$i = (int) round( $p * ( $n - 1 ) );
		return $v[ max( 0, min( $n - 1, $i ) ) ];
	}
}
