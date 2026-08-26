<?php
/**
 * What we hold about a person, why we are allowed to, and how they get it back
 * or get rid of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REGISTER IS THE CODE'S OWN ACCOUNT OF ITSELF
 *
 * `register()` is the article 30 record of processing, and every row of it was
 * written by reading the file that does the writing. It is not a document that
 * describes the shop from memory: it is the thing the privacy page renders, so a
 * treatment that is not in it is a treatment the visitor is not told about, and a
 * row that describes something the code no longer does is a false statement made
 * to a data subject. `scripts/legal-verify.mjs` checks the two halves that CAN be
 * checked mechanically: that every store the register names still exists, and
 * that every retention it states is the one a mechanism enforces.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ERASURE IS THE HARD ONE AND IT IS THE ONE THAT GETS FAKED
 *
 * A customer's data is in four places at once and only one of them is the
 * WooCommerce order. It is also the frozen bon a tirer, which holds a SECOND
 * copy of their name, company, e-mail, IP and user agent inside one meta blob;
 * the artwork and the previews in R2, on Cloudflare; the outbox row that proves
 * we sent them something; and the invoice, which the code de commerce says we
 * keep for ten years whether they ask or not.
 *
 * WooCommerce's own eraser touches the first of those and stops. Measured on the
 * mirror: `woocommerce_erasure_request_removes_order_data` is 'no', so today it
 * changes nothing at all, and even switched on it anonymises twenty-four order
 * properties and four meta keys, none of them ours, and DELETES EVERY ORDER
 * NOTE, which on this shop is where the claims history lives (`Claim::open`
 * writes one). So we do not switch it on. We do our own, we say what we did, and
 * we say what we kept and under which article.
 *
 * THE INVOICE IS WHY THE ORDER CAN BE ERASED AT ALL. Session 04 froze the whole
 * document into `_teeshoop_invoice_document` at issue, buyer identity included,
 * because `calculate_taxes()` reprices a placed order. That freeze is what lets
 * this file empty the live billing fields: the accounting record survives in the
 * one place the law wants it, and the working copy goes.
 *
 * AND IF R2 CANNOT BE REACHED, THE ERASURE FAILED. It does not report success
 * with a footnote. "We could not ask" is not "it is gone", and this repository
 * has had that exact conflation delete a customer's layer from both the transfer
 * and the price. The request stays open and says why.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Design.php';
require_once __DIR__ . '/Money.php';
/*
 * `register()` reads `Quote::KEEP_DAYS` rather than writing three years a
 * second time, so this file depends on that one. Named here rather than left
 * to the plugin bootstrap: the pure test suite loads this file alone, and a
 * dependency that only resolves because something else happened to be loaded
 * first is a dependency that breaks the day the order changes.
 */
require_once __DIR__ . '/Quote.php';

final class Privacy {

	/** Order meta: the day the artwork behind this order was erased. */
	public const META_ERASED = '_teeshoop_creations_effacees';

	/**
	 * How many records one page of an export or an erasure handles.
	 *
	 * PUBLIC, because `more_to_do()` decides termination against it and
	 * `Quote::by_email()` paginates by it. Two page sizes and one rule about when
	 * the page is full is a rule that is wrong for one of its two callers.
	 */
	public const PAGE = 20;

	/**
	 * How long the outbox keeps a row.
	 *
	 * WHAT IT IS FOR decides it. The outbox exists to answer « le client a-t-il
	 * été prévenu », and that question is asked while an order is live and for as
	 * long afterwards as a claim can arrive. The legal warranty of conformity
	 * runs two years from delivery (article L217-3), so a row older than that
	 * proves nothing anybody will still ask about, and it holds an address.
	 *
	 * IT IS A DURATION WITH A MECHANISM: `purge_outbox()` runs daily. A retention
	 * written in a privacy policy and enforced by nothing is a false statement
	 * made to the person it is about, which is the failure `Quote::KEEP_DAYS`
	 * exists to avoid on the other document.
	 */
	public const OUTBOX_KEEP_DAYS = 730;

	/** The daily job that applies the retentions this file states. */
	public const CRON = 'teeshoop_purge_donnees';

	// ── the register, pure ───────────────────────────────────────────────────

	/**
	 * Every processing this shop performs, in the article 30 shape.
	 *
	 * `duree` is prose because some retentions are relative to an event the code
	 * cannot date in the abstract. Where a duration IS enforced by a mechanism,
	 * `mecanisme` names it, and where nothing enforces it that field says so
	 * rather than being left out: a reader must be able to tell a retention we
	 * apply from one we merely intend.
	 *
	 * `destinataires` NAMES ONLY WHOEVER IS NOT US. The workshop reading an order
	 * to print it is this company doing its own work, not a recipient, and
	 * listing it beside Stripe would make the register look like it discloses
	 * more than it does. Every key here must exist in `processors()`, and
	 * `tests/integration-rgpd.php` fails when one does not.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function register(): array {
		return array(
			array(
				'cle'           => 'commande',
				'nom'           => 'Commandes et exécution des ventes',
				'finalite'      => 'Prendre une commande, la produire, la livrer et en assurer le suivi.',
				'base'          => 'Exécution du contrat (article 6.1.b du RGPD)',
				'personnes'     => 'Clients, particuliers et professionnels',
				'donnees'       => array(
					'Identité : nom, prénom, société',
					'Coordonnées : adresse de facturation, adresse de livraison, courriel, téléphone',
					'Identifiants professionnels : SIRET lorsqu’il est fourni',
					'Contenu de la commande : articles, tailles, quantités, visuels',
					'Adresse IP au moment de la commande, pour l’acceptation des conditions',
				),
				'destinataires' => array( 'stripe', 'brevo', 'colissimo', 'o2switch' ),
				'duree'         => 'Le temps de la relation commerciale. Sur demande d’effacement, les données de la commande sont anonymisées immédiatement ; seule la facture est conservée.',
				'mecanisme'     => 'Effacement à la demande, par les outils de confidentialité de WordPress.',
			),
			array(
				'cle'           => 'facture',
				'nom'           => 'Facturation et comptabilité',
				'finalite'      => 'Émettre les factures et tenir la comptabilité.',
				'base'          => 'Obligation légale (article 6.1.c du RGPD)',
				'personnes'     => 'Clients, particuliers et professionnels',
				'donnees'       => array(
					'Identité et adresse de facturation figurant sur la facture',
					'Numéro de SIRET et numéro de TVA lorsqu’ils figurent sur la facture',
					'Montants, taux de taxe et encaissements',
				),
				'destinataires' => array( 'comptable', 'o2switch' ),
				'duree'         => 'Dix ans à compter de la clôture de l’exercice, conformément à l’article L123-22 du code de commerce. Cette conservation survit à une demande d’effacement, et la personne en est informée.',
				'mecanisme'     => 'Aucune suppression automatique à ce jour : la facture est figée sur la commande et un balayage à dix ans reste à écrire.',
			),
			array(
				'cle'           => 'bat',
				'nom'           => 'Bons à tirer',
				'finalite'      => 'Faire valider ce qui sera imprimé, et pouvoir prouver cette validation.',
				'base'          => 'Exécution du contrat, et intérêt légitime à conserver une preuve (articles 6.1.b et 6.1.f)',
				'personnes'     => 'Clients',
				'donnees'       => array(
					'Identité et courriel du client, recopiés sur le document',
					'Visuel, dimensions, emplacement, tailles et quantités',
					'Date, heure, adresse IP et navigateur de la validation ou du refus',
					'Commentaires écrits par le client lors d’une demande de modification',
				),
				'destinataires' => array( 'brevo', 'cloudflare', 'o2switch' ),
				'duree'         => 'Le temps de la relation commerciale, puis anonymisé avec la commande sur demande d’effacement.',
				'mecanisme'     => 'Effacement à la demande.',
			),
			array(
				'cle'           => 'creation',
				'nom'           => 'Créations et fichiers d’impression',
				'finalite'      => 'Conserver le visuel commandé pour produire, contrôler et refaire à l’identique.',
				'base'          => 'Exécution du contrat (article 6.1.b du RGPD)',
				'personnes'     => 'Clients et visiteurs qui composent une création',
				'donnees'       => array(
					'Le document de création : calques, positions, couleurs',
					'Les fichiers téléversés par le client, qui peuvent être une photographie',
					'Les textes saisis par le client, qui peuvent être un nom',
					'Les aperçus rendus à partir de ces éléments',
				),
				'destinataires' => array( 'cloudflare' ),
				/*
				 * THIS SENTENCE SAID SOMETHING FALSE AND IT WAS SAID TO THE
				 * PERSON IT IS ABOUT.
				 *
				 * It read « elle est supprimée par un balayage périodique », in
				 * the present indicative, on a page a visitor is sent to from the
				 * consent panel. `POST /api/design/reap` exists and NOTHING calls
				 * it: no cron, no WP-CLI subcommand, no scheduled event, and R2's
				 * only lifecycle rule covers the `ar/` prefix. So an abandoned
				 * basket's upload, which can be a photograph of a person, is kept
				 * for ever while the page says it is swept.
				 *
				 * The duration is question 33's and nobody has answered it, so the
				 * honest text is the one below: the tool exists, the period is not
				 * set, and until it is nothing expires. `H-Q33-CONSERVATION-CREATIONS`
				 * records the same fact in the register as a REFUSAL rather than
				 * as an assumption.
				 */
				'duree'         => 'Le temps de la relation commerciale, effacé sur demande. Une création composée mais jamais commandée n’est rattachée à personne et ne peut pas être retrouvée à partir d’une identité : aucune durée de conservation n’est encore fixée pour celles-là, et elles ne sont donc pas supprimées automatiquement.',
				'mecanisme'     => 'Effacement à la demande par appel au service qui les héberge. Aucun balayage périodique n’est en service : l’outil existe, la durée reste à décider.',
			),
			array(
				'cle'           => 'devis',
				'nom'           => 'Demandes de devis',
				'finalite'      => 'Répondre à une demande de prix et la suivre.',
				'base'          => 'Mesures précontractuelles à la demande de la personne (article 6.1.b du RGPD)',
				'personnes'     => 'Prospects',
				'donnees'       => array(
					'Identité, société, courriel, téléphone, SIRET',
					'Le message écrit par la personne et son échéance',
					'La page d’arrivée, le site référent et la campagne, lorsque le visiteur les a autorisés',
				),
				'destinataires' => array( 'o2switch' ),
				/*
				 * THE NUMBER COMES FROM ITS HOME, not from this sentence. It is
				 * announced under the quote form, written into the conditions of
				 * sale and printed here; three copies of a retention period is
				 * how one of them ends up describing a sweep that deletes on a
				 * different day. `Quote::KEEP_DAYS` is the one that the cron
				 * actually reads.
				 */
				'duree'         => sprintf(
					'Conservée %s jours après le dernier échange, soit trois ans, puis supprimée automatiquement.',
					Money::number( (float) Quote::KEEP_DAYS )
				),
				'mecanisme'     => 'Suppression automatique quotidienne (Quote::purge).',
			),
			array(
				'cle'           => 'sav',
				'nom'           => 'Réclamations et service après-vente',
				'finalite'      => 'Traiter un problème sur une commande et décider qui le prend en charge.',
				'base'          => 'Exécution du contrat (article 6.1.b du RGPD)',
				'personnes'     => 'Clients',
				'donnees'       => array(
					'Le motif, la description écrite par le client et les quantités concernées',
					'La décision prise et sa justification',
				),
				'destinataires' => array( 'o2switch' ),
				'duree'         => 'Anonymisé avec la commande sur demande d’effacement.',
				'mecanisme'     => 'Effacement à la demande.',
			),
			array(
				'cle'           => 'messages',
				'nom'           => 'Messages envoyés',
				'finalite'      => 'Prouver qu’un client a bien été prévenu, et pouvoir renvoyer un message qui n’est pas parti.',
				'base'          => 'Intérêt légitime à prouver l’exécution du contrat (article 6.1.f du RGPD)',
				'personnes'     => 'Clients',
				'donnees'       => array(
					'Adresse du destinataire, objet du message, date, état de l’envoi',
					'Le corps du message n’est pas conservé.',
				),
				'destinataires' => array( 'brevo', 'o2switch' ),
				'duree'         => sprintf(
					'Conservée %s jours, soit deux ans, alignés sur la garantie légale de conformité.',
					Money::number( (float) self::OUTBOX_KEEP_DAYS )
				),
				'mecanisme'     => 'Suppression automatique quotidienne (Privacy::purge_outbox).',
			),
			array(
				'cle'           => 'mesure',
				'nom'           => 'Mesure de provenance',
				'finalite'      => 'Savoir quelle page a amené une demande de devis ou une commande.',
				'base'          => 'Consentement (article 6.1.a du RGPD et article 82 de la loi Informatique et Libertés)',
				'personnes'     => 'Visiteurs',
				'donnees'       => array(
					'Page d’arrivée, site référent, nom de la campagne',
					'Un compteur de pages et le nom du navigateur, pour la durée de la visite',
				),
				'destinataires' => array( 'o2switch' ),
				'duree'         => 'Treize mois au maximum, et rien du tout sans consentement.',
				'mecanisme'     => 'Cookies à durée bornée, retirés dès le refus.',
			),
		);
	}

	/**
	 * Who else touches it, and where.
	 *
	 * EACH LINE IS DERIVED FROM A CALL SITE, not from a list of vendors. A
	 * register built from what a company uses rather than from what its code
	 * does is a register that names a processor nobody sends anything to and
	 * misses the one that receives everything.
	 *
	 * The suppliers are on this list as an EXCLUSION, with the reason, because
	 * "we checked and they receive nothing" and "we did not think about them"
	 * must not read the same.
	 *
	 * @return array<string,array<string,string>>
	 */
	public static function processors(): array {
		return array(
			'o2switch'   => array(
				'role'    => 'Hébergeur du site et de sa base de données',
				'traite'  => 'Toutes les données ci-dessus, sauf les créations et les aperçus.',
				'lieu'    => 'France',
				'contrat' => 'Contrat d’hébergement, clauses de sous-traitance à récupérer.',
			),
			'cloudflare' => array(
				'role'    => 'Hébergeur de l’outil de personnalisation et des créations',
				'traite'  => 'Documents de création, fichiers téléversés par le client, aperçus.',
				'lieu'    => 'Union européenne, avec des clauses contractuelles types pour les transferts hors UE.',
				'contrat' => 'Avenant de traitement des données de Cloudflare, à confirmer sur le compte.',
			),
			'stripe'     => array(
				'role'    => 'Prestataire de paiement',
				'traite'  => 'Coordonnées de facturation et données de carte. Aucune donnée de carte ne passe par nos serveurs.',
				'lieu'    => 'Irlande et États-Unis, sous clauses contractuelles types.',
				'contrat' => 'Avenant de traitement des données de Stripe, à confirmer sur le compte.',
			),
			'brevo'      => array(
				'role'    => 'Envoi des courriers électroniques transactionnels',
				'traite'  => 'Adresse et nom du destinataire, objet et corps du message, ce qui inclut le lien de validation d’un bon à tirer.',
				'lieu'    => 'France',
				'contrat' => 'Avenant de traitement des données de Brevo, à signer : le compte n’est pas encore ouvert.',
			),
			'colissimo'  => array(
				'role'    => 'Transporteur',
				'traite'  => 'Nom, adresse de livraison et téléphone du destinataire.',
				'lieu'    => 'France',
				'contrat' => 'À récupérer avec le contrat de transport.',
			),
			'comptable'  => array(
				'role'    => 'Expert-comptable',
				'traite'  => 'Factures et encaissements.',
				'lieu'    => 'France',
				'contrat' => 'À établir : le cabinet n’est pas désigné.',
			),
			'fournisseurs' => array(
				'role'    => 'Fournisseurs de textile, PAS destinataires',
				'traite'  => 'Rien. Le bon de commande fournisseur ne porte que des références d’articles et une clé de commande interne, jamais l’adresse ni le nom d’un client. Les colis sont livrés à l’atelier.',
				'lieu'    => 'Sans objet',
				'contrat' => 'Sans objet, faute de données personnelles transmises.',
			),
		);
	}

	/**
	 * What is written on a visitor's machine, and under what regime.
	 *
	 * ONE PLACE, and it deliberately reaches into `Consent` for the half that is
	 * consented rather than restating it: the panel and the policy describing the
	 * same cookie differently is how a visitor is told one thing and given
	 * another.
	 *
	 * @return array<int,array<string,string>>
	 */
	public static function trackers(): array {
		$out = array(
			array(
				'nom'    => 'teeshoop_choix',
				'objet'  => 'Retenir votre décision sur les traceurs, pour ne plus vous la demander.',
				'duree'  => 'Treize mois',
				'regime' => 'Nécessaire au fonctionnement, exempté de consentement',
			),
			array(
				'nom'    => 'woocommerce_items_in_cart, woocommerce_cart_hash, wp_woocommerce_session_*',
				'objet'  => 'Garder votre panier d’une page à l’autre.',
				'duree'  => 'La visite, et deux jours pour la session',
				'regime' => 'Nécessaire au fonctionnement, exempté de consentement',
			),
			array(
				'nom'    => 'storeApiNonce, storeApiCartData',
				'objet'  => 'Afficher le panier et la page de commande, et protéger leurs formulaires.',
				'duree'  => 'La visite',
				'regime' => 'Nécessaire au fonctionnement, exempté de consentement',
			),
			array(
				'nom'    => 'wc-blocks_dismissed_incompatible_extensions_notices',
				'objet'  => 'Écrit par la boutique elle-même pour retenir un message d’administration masqué. Il ne contient aucun identifiant et rien ne le lit de notre côté.',
				'duree'  => 'Jusqu’à effacement par le navigateur',
				'regime' => 'Écriture technique de l’extension de boutique, que nous ne pouvons pas supprimer',
			),
		);

		foreach ( Consent::categories() as $key => $cat ) {
			if ( ! $cat['offered'] ) {
				continue;
			}
			$out[] = array(
				'nom'    => 'attribution' === $key ? 'teeshoop_src, sbjs_*' : $key,
				'objet'  => $cat['detail'],
				'duree'  => 'Treize mois au maximum',
				'regime' => 'Soumis à votre consentement, rien n’est écrit sans lui',
			);
		}

		return $out;
	}

	// ── WordPress: the rights ────────────────────────────────────────────────

	public static function init(): void {
		add_filter( 'wp_privacy_personal_data_exporters', array( self::class, 'register_exporters' ) );
		add_filter( 'wp_privacy_personal_data_erasers', array( self::class, 'register_erasers' ) );

		if ( ! wp_next_scheduled( self::CRON ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::CRON );
		}
		add_action( self::CRON, array( self::class, 'purge_outbox' ) );
	}

	/** @param array<string,array> $exporters */
	public static function register_exporters( array $exporters ): array {
		$exporters['teeshoop-commandes'] = array(
			'exporter_friendly_name' => __( 'Commandes Teeshoop', 'teeshoop' ),
			'callback'               => array( self::class, 'export_orders' ),
		);
		return $exporters;
	}

	/** @param array<string,array> $erasers */
	public static function register_erasers( array $erasers ): array {
		$erasers['teeshoop-commandes'] = array(
			'eraser_friendly_name' => __( 'Commandes Teeshoop', 'teeshoop' ),
			'callback'             => array( self::class, 'erase_orders' ),
		);
		$erasers['teeshoop-messages'] = array(
			'eraser_friendly_name' => __( 'Messages envoyés par Teeshoop', 'teeshoop' ),
			'callback'             => array( self::class, 'erase_outbox' ),
		);
		return $erasers;
	}

	/**
	 * The orders of one e-mail address, one page at a time.
	 *
	 * @return \WC_Order[]
	 */
	private static function orders_of( string $email, int $page ): array {
		if ( ! function_exists( 'wc_get_orders' ) || '' === $email ) {
			return array();
		}
		$orders = wc_get_orders(
			array(
				'limit'    => self::PAGE,
				'page'     => max( 1, $page ),
				'orderby'  => 'ID',
				'order'    => 'ASC',
				'customer' => $email,
				/*
				 * THE BIN COUNTS, AND LEAVING IT OUT WAS THE SAME DEFECT THIS
				 * COMMIT FIXED FOR QUOTE REQUESTS AND NOT FOR ORDERS.
				 *
				 * `wc_get_order_statuses()` never contains `trash`. A shop
				 * manager binning an order is one click on the orders list, and
				 * HPOS keeps the whole `wp_wc_order_addresses` row when it does:
				 * measured on the mirror, a trashed order still held first name,
				 * last name, company, street, city, postcode, e-mail and
				 * telephone after an erasure that reported success and printed
				 * « les coordonnées ont été effacées ».
				 */
				'status'   => array_merge( array_keys( wc_get_order_statuses() ), array( 'trash' ) ),
			)
		);
		return is_array( $orders ) ? $orders : array();
	}

	/**
	 * Article 15: a copy of what we hold, in the shape WordPress exports.
	 */
	public static function export_orders( string $email, int $page = 1 ): array {
		$orders = self::orders_of( $email, $page );
		$data   = array();

		foreach ( $orders as $order ) {
			$rows = array(
				array(
					'name'  => __( 'Numéro de commande', 'teeshoop' ),
					'value' => $order->get_order_number(),
				),
				array(
					'name'  => __( 'Date', 'teeshoop' ),
					'value' => $order->get_date_created() ? $order->get_date_created()->date( 'c' ) : '',
				),
			);

			$waiver = Waiver::record( $order );
			if ( null !== $waiver ) {
				$rows[] = array(
					'name'  => __( 'Renonciation au droit de rétractation', 'teeshoop' ),
					'value' => sprintf(
						/* translators: 1: date, 2: terms version, 3: the sentence shown. */
						__( 'Acceptée le %1$s, conditions générales version %2$s. Texte affiché : %3$s', 'teeshoop' ),
						(string) ( $waiver['at'] ?? '' ),
						'' !== (string) ( $waiver['cgv'] ?? '' ) ? (string) $waiver['cgv'] : __( 'aucune, aucune version n’était publiée', 'teeshoop' ),
						(string) ( $waiver['text'] ?? '' )
					),
				);
			}

			foreach ( self::design_ids_of_order( $order ) as $id ) {
				$rows[] = array(
					'name'  => __( 'Création', 'teeshoop' ),
					'value' => $id,
				);
			}

			/*
			 * THE BON À TIRER, THE CLAIMS AND THE OUTBOX, WHICH THE FIRST VERSION
			 * OF THIS EXPORTER LEFT OUT.
			 *
			 * Article 15 asks for a copy of ALL the personal data undergoing
			 * processing, and the register on the same page tells the person we
			 * hold these three. Measured on the mirror: the proof carried a
			 * second copy of their name, company and e-mail plus the IP and
			 * browser of the moment they approved, the claims carried their own
			 * description, and neither appeared in the export. Reporting the
			 * order number and the invoice list and stopping was answering with
			 * the part we were comfortable showing.
			 */
			$bat = $order->get_meta( '_teeshoop_bat', true );
			if ( '' !== (string) $bat ) {
				$doc = json_decode( (string) $bat, true );
				if ( is_array( $doc ) ) {
					$rows[] = array(
						'name'  => __( 'Bon à tirer : ce qu’il porte de vous', 'teeshoop' ),
						'value' => (string) wp_json_encode(
							array_intersect_key(
								(array) ( $doc['customer'] ?? array() ),
								array_flip( array( 'name', 'nom', 'company', 'societe', 'email' ) )
							)
						),
					);
					foreach ( array( 'approval', 'changes' ) as $part ) {
						if ( ! empty( $doc[ $part ] ) ) {
							$rows[] = array(
								'name'  => 'approval' === $part
									? __( 'Bon à tirer : votre validation', 'teeshoop' )
									: __( 'Bon à tirer : vos demandes de modification', 'teeshoop' ),
								'value' => (string) wp_json_encode( $doc[ $part ] ),
							);
						}
					}
				}
			}

			$claims = json_decode( (string) $order->get_meta( '_teeshoop_reclamations', true ), true );
			if ( is_array( $claims ) ) {
				foreach ( $claims as $n => $claim ) {
					if ( ! is_array( $claim ) ) {
						continue;
					}
					$rows[] = array(
						'name'  => sprintf(
							/* translators: %d: the index of the claim, from 1. */
							__( 'Réclamation n°%d', 'teeshoop' ),
							(int) $n + 1
						),
						'value' => (string) wp_json_encode(
							array_intersect_key(
								$claim,
								array_flip( array( 'motif', 'cause', 'quantite', 'description', 'decision', 'opened_at', 'closed_at' ) )
							)
						),
					);
				}
			}

			$invoices = $order->get_meta( '_teeshoop_factures', true );
			if ( is_array( $invoices ) && ! empty( $invoices ) ) {
				$rows[] = array(
					'name'  => __( 'Factures émises', 'teeshoop' ),
					'value' => implode( ', ', array_map( static fn( $f ): string => (string) ( is_array( $f ) ? ( $f['numero'] ?? '' ) : $f ), $invoices ) ),
				);
			}

			$data[] = array(
				'group_id'    => 'teeshoop-commandes',
				'group_label' => __( 'Commandes Teeshoop', 'teeshoop' ),
				'item_id'     => 'commande-' . $order->get_id(),
				'data'        => $rows,
			);
		}

		/*
		 * THE OUTBOX, ONCE, ON THE FIRST PAGE. It is keyed on an address and not
		 * on an order, so it belongs to the person rather than to any one of
		 * their orders, and repeating it per order would report the same rows
		 * twenty times.
		 */
		if ( 1 === max( 1, $page ) ) {
			foreach ( self::messages_to( $email ) as $row ) {
				$data[] = array(
					'group_id'    => 'teeshoop-messages',
					'group_label' => __( 'Messages que nous vous avons envoyés', 'teeshoop' ),
					'item_id'     => 'message-' . (int) $row->id,
					'data'        => array(
						array(
							'name'  => __( 'Date', 'teeshoop' ),
							'value' => (string) $row->created_at,
						),
						array(
							'name'  => __( 'Objet', 'teeshoop' ),
							'value' => (string) $row->subject,
						),
						array(
							'name'  => __( 'État de l’envoi', 'teeshoop' ),
							'value' => (string) $row->status,
						),
					),
				);
			}
		}

		return array(
			'data' => $data,
			'done' => count( $orders ) < self::PAGE,
		);
	}

	/**
	 * The outbox rows for one address.
	 *
	 * @return object[]
	 */
	private static function messages_to( string $email ): array {
		global $wpdb;
		if ( '' === $email || ! isset( $wpdb ) ) {
			return array();
		}
		$table = $wpdb->prefix . 'teeshoop_mail';
		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = $wpdb->get_results(
			$wpdb->prepare( "SELECT id, created_at, subject, status FROM {$table} WHERE recipient = %s ORDER BY id ASC LIMIT 200", $email )
		);
		// phpcs:enable
		return is_array( $rows ) ? $rows : array();
	}

	/**
	 * Article 17, honestly.
	 *
	 * PAGE 1 EVERY TIME, and that is a fix rather than an oversight.
	 * `Quote::erase_personal_data` paginates with an OFFSET while deleting, so
	 * page 2 skips the twenty rows page 1 removed, and a prospect with more than
	 * twenty requests keeps most of them for ever. Here the work of erasing an
	 * order is what advances the window, so the window must not advance too: an
	 * order this pass anonymised no longer matches the address, so the next page
	 * of the same query is the next twenty that still do. `done` is therefore
	 * decided by whether anything remained, not by a page count.
	 */
	public static function erase_orders( string $email, int $page = 1 ): array {
		$orders   = self::orders_of( $email, 1 );
		$removed  = false;
		$retained = false;
		$messages = array();

		foreach ( $orders as $order ) {
			$result = self::erase_order( $order );
			$removed  = $removed || $result['removed'];
			$retained = $retained || $result['retained'];
			$messages = array_merge( $messages, $result['messages'] );
		}

		/*
		 * A PASS THAT ERASED NOTHING IS THE LAST PASS, AND SAYING OTHERWISE IS AN
		 * INFINITE LOOP.
		 *
		 * WordPress calls an eraser with page 1, then page 2, until `done`, and
		 * this one deliberately re-reads page 1 every time because erasing is
		 * what advances the window (see the note above). That is only safe while
		 * the window actually shrinks. Two states where it does not: a customer
		 * whose orders are ALL already erased (each returns removed:false and
		 * still matches the address, because a billing e-mail that has been
		 * emptied no longer matches but an already-erased order was found by
		 * something else), and the one that matters, R2 unreachable, where every
		 * order refuses and stays exactly as it was. With `count($orders) < PAGE`
		 * as the only test, a customer with twenty such orders sends the admin
		 * screen round the same twenty for ever, and the operator sees a request
		 * that never finishes rather than a reason.
		 *
		 * So progress decides. Nothing removed means there is nothing more this
		 * pass can do, the request ends, and the messages say why: an erasure
		 * that could not reach the artwork has already put its reason in there.
		 */
		return array(
			'items_removed'  => $removed,
			'items_retained' => $retained,
			'messages'       => array_values( array_unique( $messages ) ),
			'done'           => ! self::more_to_do( $removed, count( $orders ) ),
		);
	}

	/**
	 * Whether another pass could do anything, given what this one did.
	 *
	 * PURE, AND SEPARATE, because the loop it decides cannot be exercised without
	 * twenty orders and a broken Worker at the same time. `tests/test-privacy.php`
	 * covers all four states in microseconds; the integration suite proves the
	 * end of the chain.
	 *
	 * @param bool $removed whether this pass erased anything at all.
	 * @param int  $found   how many orders the pass was handed.
	 */
	public static function more_to_do( bool $removed, int $found ): bool {
		return $removed && $found >= self::PAGE;
	}

	/**
	 * Erase one order: the live copy goes, the accounting record stays.
	 *
	 * @return array{removed:bool,retained:bool,messages:string[]}
	 */
	public static function erase_order( \WC_Order $order ): array {
		$messages = array();
		// Read before anything is emptied: the outbox is keyed on this address.
		$email = (string) $order->get_billing_email();

		if ( '' !== (string) $order->get_meta( self::META_ERASED, true ) ) {
			return array(
				'removed'  => false,
				'retained' => true,
				'messages' => array(),
			);
		}

		/*
		 * THE ARTWORK FIRST, because it is the only part that lives on somebody
		 * else's machine and the only part that can fail. Emptying the order and
		 * then discovering the Worker is unreachable would leave us unable to
		 * find the designs again: the order-item meta we just cleared IS the
		 * index.
		 */
		$ids  = self::design_ids_of_order( $order );
		$gone = true;
		foreach ( $ids as $id ) {
			$r = self::delete_design( $id );
			if ( ! $r['ok'] ) {
				$gone = false;
				$messages[] = sprintf(
					/* translators: 1: design identifier, 2: the reason it failed. */
					__( 'La création %1$s n’a pas pu être supprimée de son hébergement (%2$s). La demande reste ouverte.', 'teeshoop' ),
					$id,
					$r['reason']
				);
			}
		}
		if ( ! $gone ) {
			/*
			 * FAIL CLOSED ON A CLAIM. Nothing else is touched, because a partly
			 * erased order whose index has been wiped is worse than an untouched
			 * one: nobody can finish the job afterwards.
			 */
			return array(
				'removed'  => false,
				'retained' => true,
				'messages' => $messages,
			);
		}

		foreach ( self::identity_props() as $prop ) {
			$setter = 'set_' . $prop;
			if ( is_callable( array( $order, $setter ) ) ) {
				$order->{$setter}( '' );
			}
		}
		$order->set_customer_id( 0 );
		$order->set_customer_note( '' );

		foreach ( self::identity_meta() as $key ) {
			$order->delete_meta_data( $key );
		}
		/*
		 * WooCommerce's own order attribution, which `Consent` now gates but which
		 * is still on every order taken before it did: the session entry URL, the
		 * page count, the device type and the full User-Agent, beside a named
		 * customer. WooCommerce's eraser does not touch these; its meta list is
		 * four PayPal keys.
		 *
		 * THE NAMES ARE COLLECTED FIRST AND DELETED AFTER. `get_meta_data()`
		 * re-indexes on every deletion, so reading it inside the loop that deletes
		 * from it skips every other key.
		 */
		$attribution = array();
		foreach ( $order->get_meta_data() as $meta ) {
			$key = (string) $meta->key;
			if ( str_starts_with( $key, '_wc_order_attribution_' ) ) {
				$attribution[] = $key;
			}
		}
		foreach ( $attribution as $key ) {
			$order->delete_meta_data( $key );
		}

		$order->update_meta_data( '_teeshoop_bat', self::scrub_bat( (string) $order->get_meta( '_teeshoop_bat', true ) ) );
		$order->update_meta_data( '_teeshoop_renonciation', self::scrub_waiver( (string) $order->get_meta( '_teeshoop_renonciation', true ) ) );
		$order->update_meta_data( '_teeshoop_reclamations', self::scrub_claims( (string) $order->get_meta( '_teeshoop_reclamations', true ) ) );

		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$item->delete_meta_data( '_teeshoop_design_id' );
			$item->delete_meta_data( '_teeshoop_files' );
			/*
			 * THE KEY IS ACCENTED, AND DELETING THE UNACCENTED SPELLING DELETED
			 * NOTHING. `Cart::persist_to_order` writes it as `__( 'Création' )`,
			 * with no leading underscore, so WooCommerce prints it on the admin
			 * order screen, on the order-received page, in the account area and
			 * in every order e-mail. Measured byte for byte on the mirror: the
			 * key is 4372C3A96174696F6E and the line still read
			 * « Création : 2vExPKI0AbxNs6VYHQBWEqe2 » after an erasure that
			 * reported the creations had been erased.
			 *
			 * It reads the same string the writer wrote rather than a copy of it,
			 * so a translation cannot separate them.
			 */
			$item->delete_meta_data( __( 'Création', 'teeshoop' ) );
			$item->save();
		}

		$order->update_meta_data( self::META_ERASED, gmdate( 'c' ) );
		$order->save();

		self::forget_notes( $order );
		self::forget_recipient( $email );

		$messages[] = __( 'Les coordonnées, le bon à tirer, la réclamation éventuelle et les créations de cette commande ont été effacés.', 'teeshoop' );
		$messages[] = sprintf(
			/* translators: %s: the order number. */
			__( 'La facture de la commande %s est conservée dix ans au titre de l’article L123-22 du code de commerce. Elle porte le nom et l’adresse qui y figuraient : une facture dont l’acheteur est caviardé n’est plus une pièce comptable.', 'teeshoop' ),
			$order->get_order_number()
		);

		return array(
			'removed'  => true,
			'retained' => true,
			'messages' => $messages,
		);
	}

	/**
	 * The order notes this shop wrote that carry a customer's own words.
	 *
	 * WHY NOT ALL OF THEM, which is what WooCommerce's eraser does. This file's
	 * header refuses that eraser precisely because it deletes every note, and on
	 * this shop the notes are where the claims history lives. Deleting the lot
	 * would destroy the operational record of an order whose invoice we are
	 * required to keep.
	 *
	 * WHY ANY OF THEM. `Claim::open` writes the customer's free description into
	 * the JSON blob AND into an order note, verbatim. `scrub_claims` empties the
	 * blob and the note kept the text: measured on the mirror, a description
	 * carrying a name, a street and a telephone number survived an erasure that
	 * reported success. Free text on a claim is exactly where a person writes
	 * those.
	 *
	 * So the note is rewritten rather than deleted: it keeps saying that a claim
	 * was opened and under which motif, which is what an operator needs, and
	 * loses the sentence the customer wrote. The two notes this plugin writes are
	 * matched on the prefix they are built from, so a note somebody typed by hand
	 * is never touched.
	 *
	 * @return int how many notes were rewritten
	 */
	public static function forget_notes( \WC_Order $order ): int {
		$notes = function_exists( 'wc_get_order_notes' )
			? wc_get_order_notes( array( 'order_id' => $order->get_id() ) )
			: array();
		if ( ! is_array( $notes ) ) {
			return 0;
		}

		$prefixes = array(
			__( 'Réclamation ouverte', 'teeshoop' ),
			__( 'Réclamation tranchée', 'teeshoop' ),
		);

		$done = 0;
		foreach ( $notes as $note ) {
			$content = (string) ( $note->content ?? '' );
			foreach ( $prefixes as $prefix ) {
				if ( ! str_starts_with( $content, $prefix ) ) {
					continue;
				}
				/*
				 * `wp_update_comment` and not a delete, so the note keeps its
				 * date and its author and the history stays readable.
				 */
				wp_update_comment(
					array(
						'comment_ID'      => (int) $note->id,
						'comment_content' => $prefix . ' ' . __( '(texte effacé à la demande du client)', 'teeshoop' ),
					)
				);
				++$done;
				break;
			}
		}
		return $done;
	}

	/** The WooCommerce order properties that carry an identity. */
	private static function identity_props(): array {
		return array(
			'billing_first_name',
			'billing_last_name',
			'billing_company',
			'billing_address_1',
			'billing_address_2',
			'billing_city',
			'billing_state',
			'billing_postcode',
			'billing_phone',
			'billing_email',
			'shipping_first_name',
			'shipping_last_name',
			'shipping_company',
			'shipping_address_1',
			'shipping_address_2',
			'shipping_city',
			'shipping_state',
			'shipping_postcode',
			'shipping_phone',
			'customer_ip_address',
			'customer_user_agent',
			'transaction_id',
		);
	}

	/**
	 * Our own order meta that carries an identity or an address.
	 *
	 * `_teeshoop_invoice_document`, `_teeshoop_factures` and
	 * `_teeshoop_encaissements` are DELIBERATELY ABSENT: they are the accounting
	 * record and the ten-year retention applies to them.
	 */
	private static function identity_meta(): array {
		return array(
			'_billing_siret',
			/*
			 * AND THE TWO THE BLOCK CHECKOUT WRITES UNDER ITS OWN NAMESPACE.
			 *
			 * `Checkout` registers `teeshoop/siret` as an additional field and
			 * copies it to `_billing_siret` so the invoice reads one key, but
			 * WooCommerce keeps its own copies at `_wc_billing/teeshoop/siret`
			 * and `_wc_shipping/teeshoop/siret`. Deleting only ours left both:
			 * measured on the mirror. A sole trader's SIRET resolves to their
			 * name and their registered address in the public SIRENE register,
			 * so it is personal data about a natural person, not a company
			 * reference.
			 */
			'_wc_billing/teeshoop/siret',
			'_wc_shipping/teeshoop/siret',
			'_teeshoop_suivi',
			'_teeshoop_transporteur',
		);
	}

	/**
	 * Take the person out of a frozen proof, and keep what the proof is for.
	 *
	 * The bon a tirer holds a second copy of the customer's name, company and
	 * e-mail, plus the IP and browser of the moment they approved. The approval
	 * itself has to survive, because it is what answers « qui a validé cette
	 * erreur », and because the order it belongs to still has an invoice. So the
	 * record keeps its dates, its version and the sentence that was on screen,
	 * and loses everything that names a person.
	 */
	public static function scrub_bat( string $raw ): string {
		if ( '' === $raw ) {
			return $raw;
		}
		$doc = json_decode( $raw, true );
		if ( ! is_array( $doc ) ) {
			return $raw;
		}
		$doc = self::scrub_deep(
			$doc,
			array( 'nom', 'name', 'email', 'courriel', 'societe', 'company', 'ip', 'ua', 'commentaire', 'comment', 'note', 'by_name' )
		);
		return (string) wp_json_encode( $doc );
	}

	/** The withdrawal waiver keeps its date, its version and its words, and loses the IP. */
	public static function scrub_waiver( string $raw ): string {
		if ( '' === $raw ) {
			return $raw;
		}
		$row = json_decode( $raw, true );
		if ( ! is_array( $row ) ) {
			return $raw;
		}
		$row['ip'] = '';
		return (string) wp_json_encode( $row );
	}

	/** A claim keeps its motive and its decision, and loses the free text. */
	public static function scrub_claims( string $raw ): string {
		if ( '' === $raw ) {
			return $raw;
		}
		$rows = json_decode( $raw, true );
		if ( ! is_array( $rows ) ) {
			return $raw;
		}
		foreach ( $rows as $i => $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			foreach ( array( 'description', 'note', 'commentaire' ) as $key ) {
				if ( isset( $row[ $key ] ) ) {
					$rows[ $i ][ $key ] = '';
				}
			}
		}
		return (string) wp_json_encode( $rows );
	}

	/**
	 * Empty every value whose key is in the list, at any depth.
	 *
	 * PURE, so it can be tested without a database. It empties rather than
	 * unsets, because a consumer that reads `$doc['customer']['nom']` should get
	 * an empty string and not a notice: an erasure that makes a screen fatal gets
	 * reverted.
	 */
	public static function scrub_deep( array $node, array $keys ): array {
		foreach ( $node as $key => $value ) {
			if ( is_array( $value ) ) {
				$node[ $key ] = self::scrub_deep( $value, $keys );
				continue;
			}
			if ( in_array( (string) $key, $keys, true ) && is_string( $value ) ) {
				$node[ $key ] = '';
			}
		}
		return $node;
	}

	// ── the artwork, which lives somewhere else ──────────────────────────────

	/** Every design identifier this order still points at. */
	public static function design_ids_of_order( \WC_Order $order ): array {
		$ids = array();
		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$id = (string) $item->get_meta( '_teeshoop_design_id', true );
			if ( '' !== $id ) {
				$ids[ $id ] = true;
			}
		}
		return array_keys( $ids );
	}

	/**
	 * Ask the Worker to delete a design, and tell the truth about the answer.
	 *
	 * @return array{ok:bool,reason:string}
	 */
	public static function delete_design( string $id ): array {
		if ( ! Design::valid_id( $id ) ) {
			return array(
				'ok'     => false,
				'reason' => __( 'identifiant illisible', 'teeshoop' ),
			);
		}

		$worker = Settings::get( 'worker_url' );
		$token  = defined( 'TEESHOOP_WORKER_TOKEN' ) ? (string) constant( 'TEESHOOP_WORKER_TOKEN' ) : '';

		if ( '' === $worker || '' === $token ) {
			return array(
				'ok'     => false,
				'reason' => __( 'le service qui héberge les créations n’est pas configuré (adresse du Worker ou TEESHOOP_WORKER_TOKEN)', 'teeshoop' ),
			);
		}

		$response = wp_remote_request(
			rtrim( $worker, '/' ) . '/api/design/' . rawurlencode( $id ),
			array(
				'method'      => 'DELETE',
				'timeout'     => 15,
				'redirection' => 0,
				'headers'     => array(
					'accept'        => 'application/json',
					'authorization' => 'Bearer ' . $token,
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return array(
				'ok'     => false,
				'reason' => $response->get_error_message(),
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $code ) {
			return array(
				'ok'     => false,
				/* translators: %d: the HTTP status the Worker answered with. */
				'reason' => sprintf( __( 'le service a répondu %d', 'teeshoop' ), $code ),
			);
		}

		return array(
			'ok'     => true,
			'reason' => '',
		);
	}

	// ── the outbox ───────────────────────────────────────────────────────────

	/** Erase one address from the outbox, keeping the counts the screen needs. */
	public static function erase_outbox( string $email, int $page = 1 ): array {
		$done = self::forget_recipient( $email );
		return array(
			'items_removed'  => $done > 0,
			'items_retained' => false,
			'messages'       => $done > 0
				? array( __( 'Les traces d’envoi de messages à cette adresse ont été anonymisées.', 'teeshoop' ) )
				: array(),
			'done'           => true,
		);
	}

	/**
	 * Blank an address in the outbox without losing the row.
	 *
	 * The row itself is what tells an operator that a message failed and has not
	 * been retried; deleting it would silently close a stuck notification. So the
	 * address goes and the state stays.
	 */
	public static function forget_recipient( string $email ): int {
		global $wpdb;
		if ( '' === $email || ! isset( $wpdb ) ) {
			return 0;
		}
		$table = $wpdb->prefix . 'teeshoop_mail';
		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$done = $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$table} SET recipient = %s, subject = %s WHERE recipient = %s",
				'',
				'',
				$email
			)
		);
		// phpcs:enable
		return is_int( $done ) ? $done : 0;
	}

	/** Apply the outbox retention. Daily, bounded, and it says what it did. */
	public static function purge_outbox(): int {
		global $wpdb;
		if ( ! isset( $wpdb ) ) {
			return 0;
		}
		$table  = $wpdb->prefix . 'teeshoop_mail';
		$cutoff = gmdate( 'Y-m-d H:i:s', time() - self::OUTBOX_KEEP_DAYS * DAY_IN_SECONDS );
		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$done = $wpdb->query(
			$wpdb->prepare( "DELETE FROM {$table} WHERE created_at < %s LIMIT 500", $cutoff )
		);
		// phpcs:enable
		return is_int( $done ) ? $done : 0;
	}
}
