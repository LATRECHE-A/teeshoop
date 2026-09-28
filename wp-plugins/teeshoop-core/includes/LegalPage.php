<?php
/**
 * The four legal pages, rendered by the plugin and not typed by anybody.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PLUGIN RENDERS THEM AND NOT THE THEME
 *
 * `page-devis.php` is the house precedent: a page whose content lives in a theme
 * template. It is right for a landing page and wrong for these four. A legal page
 * that renders blank because somebody switched theme is a shop with no mentions
 * légales and no conditions of sale, and nothing would report it. So the text
 * comes from the plugin, through `the_content`, and it survives a theme change.
 *
 * IT IS ALSO WHERE THE TEXT BELONGS. The conditions of sale state the order
 * minimum, the lead time and the tolerance; the privacy page describes stores
 * this plugin created. The theme knows none of that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PAGES AGREE WITH THE INVOICE, WHICH IS THE POINT
 *
 * `Invoice::context()` asks `Legal::verdict()` and REFUSES to compose a document
 * in production when the seller identity is incomplete. A page cannot refuse to
 * render, so it does the other half, from THE SAME verdict rather than from a
 * second reading of the same facts: it names every missing mention, in the
 * largest type on the page, and in production it also tells search engines not
 * to index it. A non-compliant legal notice indexed by Google is a durable
 * public record of the non-compliance.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING HERE IS A DRAFT AND SAYS SO
 *
 * These texts were written by the people who wrote the code, from the code. No
 * lawyer has read them. Question 18 asks for that reading, and until it has
 * happened every one of the four pages carries the same banner. A draft that does
 * not say it is a draft is worse than no draft, because it gets shipped.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class LegalPage {

	public static function init(): void {
		add_filter( 'the_content', array( self::class, 'render' ), 20 );
		add_filter( 'wp_robots', array( self::class, 'robots' ) );
	}

	/** Which of our pages is being displayed, or ''. */
	public static function current(): string {
		if ( ! is_page() ) {
			return '';
		}
		$slug = (string) get_post_field( 'post_name', (int) get_queried_object_id() );
		return isset( Pages::all()[ $slug ] ) ? $slug : '';
	}

	/**
	 * Keep an incomplete legal notice out of the index, in production only.
	 *
	 * Elsewhere the page is indexable, because the preproduction is already
	 * behind HTTP authentication and a developer's machine is not on the web.
	 * The same three-way seam `Legal` uses everywhere else.
	 */
	public static function robots( array $robots ): array {
		if ( '' === self::current() ) {
			return $robots;
		}
		/*
		 * THE HOST'S IDENTITY COUNTS TOO, and reading `Legal` alone missed it.
		 * `Legal::verdict` answers about the SELLER, which is what an invoice
		 * refuses over. A mentions légales page whose seller block is complete
		 * and whose HOST block is empty is still a page that fails article 6 III
		 * of the LCEN, and it was staying indexable.
		 */
		$incomplete = Legal::REFUSE === self::verdict()['action']
			|| ( Pages::MENTIONS === self::current() && ! empty( Host::missing() ) );

		if ( $incomplete ) {
			$robots['noindex']  = true;
			$robots['nofollow'] = true;
		}
		return $robots;
	}

	/**
	 * The one verdict, asked once.
	 *
	 * `Settings::vat()` is the same reader `Invoice::context()` and
	 * `Checkout::selling_problems()` go through, so the page, the invoice and the
	 * checkout cannot answer differently about the same shop.
	 */
	public static function verdict(): array {
		$regime = Settings::vat();
		return Legal::verdict(
			Legal::identity(),
			(string) ( $regime['regime'] ?? '' ),
			Legal::environment()
		);
	}

	/**
	 * @param string $content whatever an editor typed into the page, which a legal page does not show.
	 */
	public static function render( $content ) {
		$slug = self::current();
		if ( '' === $slug || ! in_the_loop() || ! is_main_query() ) {
			return $content;
		}

		$out = self::draft_banner();

		switch ( $slug ) {
			case Pages::MENTIONS:
				$out .= self::mentions();
				break;
			case Pages::CGV:
				$out .= self::terms();
				break;
			case Pages::CONFIDENTIALITE:
				$out .= self::privacy();
				break;
			case Pages::ACCESSIBILITE:
				$out .= self::accessibility();
				break;
		}

		/*
		 * WHAT SOMEBODY TYPED IS NOT SHOWN, and this was the opposite until
		 * 26/09/2026. The editorial pages keep an editor's text above the
		 * repository's; a legal page cannot. Production proved it: the old page
		 * body, « édité par Ayurcomfort », SIRET 904 602 901 00012, sat above our
		 * block, so the mentions légales named two publishers. A legal notice
		 * that contradicts itself is worse than one that is missing, and the one
		 * that follows the code is the one an invoice agrees with. The typed text
		 * stays in the database, untouched, for whoever wants to read it back.
		 */
		return $out;
	}

	// ── the shared furniture ─────────────────────────────────────────────────

	private static function draft_banner(): string {
		return '<div class="ts-legal__draft" role="note"><p><strong>'
			. esc_html__( 'Projet, non validé par un juriste.', 'teeshoop' )
			. '</strong> '
			. esc_html__( 'Ce texte a été rédigé en interne à partir du fonctionnement réel de la boutique. Il décrit ce que nous faisons, il n’a pas été relu par un avocat, et il doit l’être avant toute vente.', 'teeshoop' )
			. '</p></div>';
	}

	private static function h2( string $text ): string {
		return '<h2 class="ts-legal__h">' . esc_html( $text ) . '</h2>';
	}

	private static function p( string $text ): string {
		return '<p>' . esc_html( $text ) . '</p>';
	}

	/** @param string[] $items */
	private static function ul( array $items ): string {
		if ( empty( $items ) ) {
			return '';
		}
		return '<ul class="ts-legal__list"><li>' . implode( '</li><li>', array_map( 'esc_html', $items ) ) . '</li></ul>';
	}

	/**
	 * A value, or the same sentence every time it is missing.
	 *
	 * ONE WORDING FOR A GAP, so that a reader can tell at a glance that six
	 * mentions are missing rather than reading six different euphemisms.
	 */
	private static function field( string $label, string $value, string $href = '' ): string {
		if ( '' !== trim( $value ) ) {
			$shown = '' !== $href ? '<a href="' . esc_url( $href, array( 'mailto', 'tel' ) ) . '">' . esc_html( $value ) . '</a>' : esc_html( $value );
			return '<dt>' . esc_html( $label ) . '</dt><dd>' . $shown . '</dd>';
		}
		return '<dt>' . esc_html( $label ) . '</dt><dd class="ts-legal__gap">'
			. esc_html__( 'non communiqué', 'teeshoop' ) . '</dd>';
	}

	/** « 07 58 48 83 98 » as « tel:+33758488398 », or '' when it is not a French number. */
	public static function tel_href( string $tel ): string {
		$digits = preg_replace( '/\D+/', '', $tel );
		if ( 1 === preg_match( '/^0[1-9]\d{8}$/', (string) $digits ) ) {
			return 'tel:+33' . substr( (string) $digits, 1 );
		}
		if ( 1 === preg_match( '/^33[1-9]\d{8}$/', (string) $digits ) ) {
			return 'tel:+' . $digits;
		}
		return '';
	}

	// ── mentions légales ─────────────────────────────────────────────────────

	private static function mentions(): string {
		$identity = Legal::identity();
		$verdict  = self::verdict();
		$labels   = Legal::fields();
		$host     = Host::identity();

		$out = '';

		if ( ! empty( $verdict['missing'] ) ) {
			/*
			 * THE PAGE CANNOT REFUSE, SO IT ACCUSES, AND IT SAYS WHAT IS ACTUALLY
			 * TRUE HERE.
			 *
			 * This branched on `missing` and claimed « la validation d'une
			 * commande est refusée » wherever a mention was absent. `Legal` does
			 * not work that way: an incomplete identity REFUSES only in
			 * production and merely STAMPS everywhere else, so on the
			 * preproduction, which the compose file sets to `staging`, the page
			 * told every visitor that orders were being refused while the
			 * checkout accepted them. Measured: verdict[staging] action=stamp,
			 * `Checkout::selling_problems()` returned zero problems, and the page
			 * said otherwise.
			 *
			 * One verdict, one `action`, and the sentence follows it.
			 */
			$refuses = Legal::REFUSE === $verdict['action'];
			$out    .= '<div class="ts-legal__stop" role="alert"><p><strong>'
				. esc_html(
					$refuses
						? __( 'Mentions obligatoires manquantes, la boutique n’est pas ouverte à la vente.', 'teeshoop' )
						: __( 'Mentions obligatoires manquantes.', 'teeshoop' )
				)
				. '</strong> '
				. esc_html(
					sprintf(
						/* translators: 1: comma-separated French labels of the missing fields, 2: what follows from it here. */
						__( 'Il manque : %1$s. %2$s', 'teeshoop' ),
						implode( ', ', array_map( 'mb_strtolower', $verdict['labels'] ) ),
						$refuses
							? __( 'Tant que ces informations ne sont pas publiées, aucune facture conforme ne peut être émise et la validation d’une commande est refusée.', 'teeshoop' )
							: __( 'Ces mentions sont obligatoires sur un site marchand français. Cet environnement n’est pas la boutique en ligne : les commandes y sont acceptées pour permettre le travail, ce qui ne serait pas le cas en production.', 'teeshoop' )
					)
				)
				. '</p></div>';
		}

		$out .= self::h2( __( 'Éditeur du site', 'teeshoop' ) );
		$out .= '<dl class="ts-legal__dl">';
		foreach ( $labels as $key => $label ) {
			$out .= self::field( $label, (string) ( $identity[ $key ] ?? '' ) );
		}
		$out .= self::field( __( 'Directeur de la publication', 'teeshoop' ), Host::publication_director() );
		// Cliquables : sur un téléphone, écrire ou appeler en un geste (CNT-06).
		$email = Host::contact_email();
		$tel   = Host::telephone();
		$out  .= self::field( __( 'Adresse de contact', 'teeshoop' ), $email, is_email( $email ) ? 'mailto:' . $email : '' );
		$out  .= self::field( __( 'Téléphone', 'teeshoop' ), $tel, self::tel_href( $tel ) );
		$out .= '</dl>';

		$out .= self::h2( __( 'Hébergeur du site', 'teeshoop' ) );
		$out .= self::p( __( 'L’article 6 III de la loi pour la confiance dans l’économie numérique impose de publier le nom et l’adresse de l’hébergeur.', 'teeshoop' ) );
		$out .= '<dl class="ts-legal__dl">';
		foreach ( Host::fields() as $key => $label ) {
			$out .= self::field( $label, (string) ( $host[ $key ] ?? '' ) );
		}
		$out .= '</dl>';

		$out .= self::h2( __( 'Propriété intellectuelle', 'teeshoop' ) );
		$out .= self::p( __( 'Les textes, les photographies et les visuels de démonstration présents sur ce site appartiennent à Teeshoop ou lui ont été confiés. Les visuels transmis par un client restent la propriété de ce client.', 'teeshoop' ) );

		$out .= self::h2( __( 'Signaler un contenu', 'teeshoop' ) );
		$out .= self::p( __( 'Un contenu publié ici qui vous paraîtrait illicite peut être signalé à l’adresse de contact ci-dessus. Précisez la page, la nature du problème et vos coordonnées, afin que nous puissions vous répondre.', 'teeshoop' ) );

		return $out;
	}

	// ── conditions générales ─────────────────────────────────────────────────

	private static function terms(): string {
		$asked = isset( $_GET['v'] ) ? sanitize_text_field( wp_unslash( $_GET['v'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading which version of a public document to show.
		$force = Terms::current();
		$want  = '' !== $asked ? $asked : $force;

		if ( '' === $want ) {
			return self::p( __( 'Aucune version des conditions générales n’est en vigueur à ce jour.', 'teeshoop' ) );
		}

		$doc = Terms::document( $want );
		if ( null === $doc ) {
			/*
			 * A VERSION THAT DOES NOT EXIST IS NOT A 404 AND NOT A REDIRECT TO
			 * TODAY'S. Somebody following a link from an old invoice must be told
			 * that the text they are looking for is not here, not quietly shown a
			 * different one and left believing it is the one they accepted.
			 */
			return '<div class="ts-legal__stop" role="alert"><p>'
				. esc_html__( 'Cette version des conditions générales n’existe pas. Si vous l’avez trouvée sur un document que nous vous avons envoyé, écrivez-nous : c’est une erreur de notre côté.', 'teeshoop' )
				. '</p></div>';
		}

		$out = '';

		/*
		 * THREE STATES AND NOT TWO, because a version dated in the FUTURE is
		 * neither in force nor superseded.
		 *
		 * `Terms::in_force()` takes today as a parameter precisely so a version
		 * can be committed and reviewed before it applies, which its own docblock
		 * advertises. This branched on `$want !== $force` alone and therefore told
		 * a reader that a text which has never applied « n'est plus celle en
		 * vigueur », then printed « Version en vigueur depuis le 1 septembre »
		 * about it, and listed it under « Versions précédentes ». Three false
		 * statements about a contract, from one missing comparison.
		 */
		$future = '' === $force || strcmp( $want, $force ) > 0;

		if ( $future ) {
			$out .= '<div class="ts-legal__note" role="note"><p>'
				. esc_html(
					'' === $force
						? sprintf(
							/* translators: %s: the date this version takes effect. */
							__( 'Cette version prend effet le %s. Aucune version n’est en vigueur à ce jour.', 'teeshoop' ),
							self::human_date( $want )
						)
						: sprintf(
							/* translators: 1: the date this version takes effect, 2: the version in force. */
							__( 'Cette version prend effet le %1$s et ne s’applique pas encore. Celle qui s’applique aujourd’hui est la version du %2$s.', 'teeshoop' ),
							self::human_date( $want ),
							self::human_date( $force )
						)
				)
				. '</p></div>';
		} elseif ( $want !== $force ) {
			$out .= '<div class="ts-legal__note" role="note"><p>'
				. esc_html(
					sprintf(
						/* translators: 1: the version being displayed, 2: the version in force. */
						__( 'Vous consultez la version du %1$s, qui n’est plus celle en vigueur. La version applicable aujourd’hui est celle du %2$s.', 'teeshoop' ),
						self::human_date( $want ),
						self::human_date( $force )
					)
				)
				. '</p></div>';
		}

		$out .= self::p(
			$future
				? sprintf(
					/* translators: %s: the date this version takes effect. */
					__( 'Version datée du %s, à effet à cette date.', 'teeshoop' ),
					self::human_date( $want )
				)
				: sprintf(
					/* translators: %s: the date this version took effect. */
					__( 'Version en vigueur depuis le %s.', 'teeshoop' ),
					self::human_date( $want )
				)
		);

		foreach ( (array) $doc['articles'] as $article ) {
			$out .= self::h2( (string) $article['titre'] );
			foreach ( (array) ( $article['paragraphes'] ?? array() ) as $paragraph ) {
				$out .= self::p( (string) $paragraph );
			}
			$out .= self::ul( array_map( 'strval', (array) ( $article['liste'] ?? array() ) ) );
		}

		/*
		 * « Précédentes » MEANS PRECEDING, so a version whose date has not
		 * arrived is not in this list. It is listed separately, saying what it
		 * is, because a text under review is a legitimate thing to publish and
		 * a misleading thing to file under history.
		 */
		$before = array();
		$after  = array();
		foreach ( Terms::versions() as $v ) {
			// The version in force is neither: it is the text above (CNT-05).
			if ( '' !== $force && strcmp( $v, $force ) < 0 ) {
				$before[] = $v;
			} elseif ( '' === $force || strcmp( $v, $force ) > 0 ) {
				$after[] = $v;
			}
		}

		$list = static function ( array $versions ): string {
			$links = array();
			foreach ( array_reverse( $versions ) as $v ) {
				$links[] = '<li><a href="' . esc_url( Terms::url( $v ) ) . '">'
					. esc_html( self::human_date( $v ) ) . '</a></li>';
			}
			return '<ul class="ts-legal__list">' . implode( '', $links ) . '</ul>';
		};

		if ( ! empty( $before ) ) {
			$out .= self::h2( __( 'Versions précédentes', 'teeshoop' ) );
			$out .= $list( $before );
		}
		if ( ! empty( $after ) ) {
			$out .= self::h2( __( 'Versions à venir', 'teeshoop' ) );
			$out .= self::p( __( 'Ces textes sont datés et ne s’appliqueront qu’à partir de leur date d’effet. Une commande reste régie par la version en vigueur au jour où elle a été passée.', 'teeshoop' ) );
			$out .= $list( $after );
		}

		return $out;
	}

	// ── données personnelles ─────────────────────────────────────────────────

	private static function privacy(): string {
		$out = self::p( __( 'Cette page décrit ce que nous enregistrons sur vous, pourquoi, sur quel fondement, combien de temps, et ce que vous pouvez en faire.', 'teeshoop' ) );

		$identity = Legal::identity();
		$out     .= self::h2( __( 'Qui est responsable', 'teeshoop' ) );
		$out     .= '' !== trim( (string) $identity['raison_sociale'] )
			? self::p(
				sprintf(
					/* translators: %s: the company name. */
					__( 'Le responsable du traitement est %s, dont les coordonnées figurent dans les mentions légales.', 'teeshoop' ),
					(string) $identity['raison_sociale']
				)
			)
			: '<p class="ts-legal__gap">' . esc_html(
				Legal::REFUSE === self::verdict()['action']
					? __( 'Le responsable du traitement n’est pas encore désigné : l’identité légale de l’exploitant n’a pas été publiée. Tant qu’elle ne l’est pas, cette page ne peut pas être considérée comme complète et la boutique n’est pas ouverte à la vente.', 'teeshoop' )
					: __( 'Le responsable du traitement n’est pas encore désigné : l’identité légale de l’exploitant n’a pas été publiée. Tant qu’elle ne l’est pas, cette page ne peut pas être considérée comme complète.', 'teeshoop' )
			) . '</p>';

		$out .= self::h2( __( 'Ce que nous enregistrons, et pourquoi', 'teeshoop' ) );
		foreach ( Privacy::register() as $row ) {
			$out .= '<h3 class="ts-legal__h3">' . esc_html( (string) $row['nom'] ) . '</h3>';
			$out .= self::p( (string) $row['finalite'] );
			$out .= self::ul(
				array_merge(
					array(
						__( 'Fondement : ', 'teeshoop' ) . (string) $row['base'],
						__( 'Personnes concernées : ', 'teeshoop' ) . (string) $row['personnes'],
						__( 'Durée : ', 'teeshoop' ) . (string) $row['duree'],
					),
					array_map(
						static fn( string $d ): string => __( 'Donnée : ', 'teeshoop' ) . $d,
						array_map( 'strval', (array) $row['donnees'] )
					)
				)
			);
		}

		$out .= self::h2( __( 'À qui ces données sont transmises', 'teeshoop' ) );
		foreach ( Privacy::processors() as $row ) {
			$out .= self::ul(
				array(
					(string) $row['role'] . ' : ' . (string) $row['traite'],
					__( 'Lieu de traitement : ', 'teeshoop' ) . (string) $row['lieu'],
				)
			);
		}

		$out .= self::h2( __( 'Ce qui est écrit sur votre appareil', 'teeshoop' ) );
		foreach ( Privacy::trackers() as $row ) {
			$out .= self::ul(
				array(
					(string) $row['nom'] . ' : ' . (string) $row['objet'],
					__( 'Durée : ', 'teeshoop' ) . (string) $row['duree'],
					(string) $row['regime'],
				)
			);
		}
		if ( class_exists( '\\Teeshoop\\Core\\Consent' ) && ! empty( Consent::offered() ) ) {
			$out .= '<p><a href="' . esc_url( Consent::reopen_url() ) . '" rel="nofollow">'
				. esc_html__( 'Revenir sur votre choix', 'teeshoop' ) . '</a></p>';
		}

		$out .= self::h2( __( 'Vos droits', 'teeshoop' ) );
		$out .= self::p( __( 'Vous pouvez demander l’accès à vos données, leur rectification, leur effacement, leur portabilité, la limitation de leur traitement, et vous opposer à un traitement fondé sur notre intérêt légitime. Écrivez-nous à l’adresse indiquée dans les mentions légales : nous répondons sous un mois.', 'teeshoop' ) );
		$out .= self::p( __( 'Deux limites, dites franchement. Une facture est conservée dix ans, parce que le code de commerce l’impose ; un effacement vide la commande et laisse la facture. Et une création composée dans l’outil de personnalisation mais jamais envoyée avec une commande ou une demande de devis n’est rattachée à aucune identité : nous ne pouvons pas la retrouver à partir de votre nom, et aucune durée de suppression automatique n’est encore fixée pour ces fichiers-là.', 'teeshoop' ) );
		$out .= self::p( __( 'Si notre réponse ne vous convient pas, vous pouvez saisir la Commission nationale de l’informatique et des libertés, 3 place de Fontenoy, TSA 80715, 75334 Paris Cedex 07.', 'teeshoop' ) );

		return $out;
	}

	// ── accessibilité ────────────────────────────────────────────────────────

	private static function accessibility(): string {
		$out  = self::p( __( 'Nous visons le niveau AA des règles WCAG 2.2 sur le parcours d’achat : le catalogue, la fiche produit, le panier et la page de commande.', 'teeshoop' ) );
		$out .= self::p( __( 'Cette déclaration décrit l’état réel du site, y compris ce qui ne va pas. Elle n’est pas un audit réalisé par un tiers.', 'teeshoop' ) );

		$out .= self::h2( __( 'Ce qui fonctionne', 'teeshoop' ) );
		$out .= self::ul(
			array(
				__( 'Le site s’utilise entièrement au clavier, avec un lien d’évitement en première position sur chaque page.', 'teeshoop' ),
				__( 'La navigation, les filtres du catalogue et le choix des traceurs fonctionnent sans JavaScript.', 'teeshoop' ),
				__( 'Les couleurs du site sont mesurées, et les contrastes du texte courant respectent le rapport de 4,5 pour 1.', 'teeshoop' ),
				__( 'Chaque coloris de vêtement porte son nom écrit à côté de la pastille, et non la seule pastille.', 'teeshoop' ),
			)
		);

		$out .= self::h2( __( 'L’éditeur de visuels n’est pas accessible, et ne le sera pas entièrement', 'teeshoop' ) );
		$out .= self::p( __( 'L’outil de personnalisation repose sur une zone de dessin où l’on déplace et redimensionne un visuel à la souris ou au doigt. Une zone de dessin ne s’annonce pas à un lecteur d’écran, et le déplacement libre n’a pas d’équivalent au clavier qui soit réellement utilisable. Nous préférons l’écrire que le laisser découvrir.', 'teeshoop' ) );
		$out .= self::p( __( 'Ce qui est accessible dans cet outil : le choix du vêtement, de la couleur et de la taille, l’envoi d’un fichier, le placement dans une zone nommée (poitrine, dos, manche) et le passage au panier. Ce qui ne l’est pas : le positionnement libre et le redimensionnement d’un visuel.', 'teeshoop' ) );

		$out .= self::h2( __( 'La voie sans éditeur', 'teeshoop' ) );
		$out .= self::p( __( 'Vous pouvez commander sans jamais ouvrir l’éditeur. Le formulaire de devis prend la quantité, les tailles, l’emplacement souhaité et votre description, en texte. Nous vous répondons par courrier électronique, vous nous envoyez votre fichier en réponse, nous plaçons le visuel pour vous, puis nous vous adressons un bon à tirer avec les cotes en centimètres. Rien n’est imprimé avant votre accord.', 'teeshoop' ) );
		/*
		 * IT SAID « le formulaire de devis accepte votre fichier » AND IT DOES
		 * NOT. There is no file input on that form: checked in the template and
		 * in the rendered page. A declaration of accessibility that promises a
		 * route which does not exist is the one kind of false statement this page
		 * cannot afford, because the reader it is written for is the reader with
		 * no alternative. The exchange described above is what actually happens.
		 */
		$out .= self::p( __( 'Ce chemin n’est pas une solution de repli au rabais : c’est le même atelier, le même prix et le même bon à tirer.', 'teeshoop' ) );

		$out .= self::h2( __( 'Nous signaler un obstacle', 'teeshoop' ) );
		$out .= self::p( __( 'Si une page vous bloque, écrivez-nous à l’adresse des mentions légales en indiquant la page et ce qui n’a pas fonctionné. Nous corrigeons et nous vous répondons.', 'teeshoop' ) );

		return $out;
	}

	/** « 26 août 2026 » from « 2026-08-26 ». */
	private static function human_date( string $iso ): string {
		$time = strtotime( $iso );
		if ( ! $time ) {
			return $iso;
		}
		return function_exists( 'wp_date' ) ? (string) wp_date( 'j F Y', $time ) : gmdate( 'j F Y', $time );
	}
}
