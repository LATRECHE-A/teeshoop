<?php
/**
 * The database's shape, versioned, and re-runnable.
 *
 * WHAT THIS REPLACES. Two tables were created by two lazy installers, each with
 * its own marker option, each with `CREATE TABLE IF NOT EXISTS` and no ALTER
 * path at all. That worked for creating a table once and could never change one:
 * add a column to either literal and no existing install would ever get it,
 * silently, because the marker already said the table was there. Session 14 needs
 * a deploy to be able to say « this database is at version N » and to move it to
 * N+1 the same way every time, on the mirror, on staging and on the shop.
 *
 * THE FOUR RULES A STEP OBEYS.
 *
 *   1. IT IS IDEMPOTENT. Running it twice does what running it once did. Not
 *      « it is skipped the second time »: actually idempotent, because a
 *      half-finished step on a shared host that hit its time limit will be run
 *      again from the top, and because `--refaire` exists for the day somebody
 *      needs to repair an install by hand.
 *   2. IT NEVER MOVES BACKWARDS. There is no `down()`. A rollback here is a
 *      database restore (docs/DEPLOIEMENT.md), because a down-migration that
 *      drops a column destroys the data the rollback exists to save.
 *   3. IT DECLARES WHETHER IT MAY RUN IN A WEB REQUEST. This is the one that is
 *      about o2switch specifically. `max_execution_time` is 0 on the CLI there
 *      and is not on the web side, and a step that walks 26 392 imported
 *      articles would be killed halfway through a page load, leaving the version
 *      un-bumped and the work half done, on a request nobody was watching. So a
 *      step is `auto` only if it is O(1): creating a table, writing an option.
 *      Anything that walks rows is CLI-only, and the plugin says so in the admin
 *      rather than trying.
 *   4. IT SAYS WHAT IT DID, in French, for a human reading a deploy log. Not
 *      « ok »: the number of rows it touched, or that it found nothing to do.
 *
 * WHY THE VERSION IS DERIVED AND NOT DECLARED. `target()` is the highest step id
 * that exists. There is no hand-kept SCHEMA_VERSION constant to forget to bump,
 * which is the same reasoning as everywhere else in this repository: two places
 * holding one number is two places that will disagree.
 *
 * WHERE IT RUNS.
 *
 *   - `wp teeshoop migrer` is the deterministic path and the one the deploy uses.
 *   - the activation hook, for someone installing the plugin by hand.
 *   - `plugins_loaded`, for `auto` steps only, which is the guarantee the two
 *     lazy installers used to give and the reason they were written that way:
 *     a site where the plugin is ALREADY active never runs an activation hook
 *     again, so a table added in a later version would never exist there.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Schema {

	/**
	 * Where the version lives.
	 *
	 * NOT `teeshoop_db_version`, which looks like it should be this and is not:
	 * it is Invoice's private marker for one table, written since before there
	 * was any notion of a plugin-wide schema. Step 3 folds it in and removes it,
	 * because a name that means one thing and reads as another is how the next
	 * person writes a bug.
	 */
	public const OPTION = 'teeshoop_schema';

	/** Held while a migration runs, so two requests do not both start one. */
	private const LOCK = 'teeshoop_schema_lock';

	/** Long enough for the slowest CLI step, short enough to clear itself. */
	private const LOCK_SECONDS = 900;

	/**
	 * Called FIRST by boot(), so the tables exist before anything asks for them.
	 *
	 * `auto()` is called here and not hooked, and that distinction cost a test
	 * run worth recording. The obvious shape is
	 * `add_action( 'plugins_loaded', 'auto', 4 )`, which never fires: boot() is
	 * itself a `plugins_loaded` callback at the default priority 10, so by the
	 * time this line runs, priority 4 is already in the past. The migration
	 * silently did nothing and `wp teeshoop migrer --etat` still answered
	 * « base en version 0 ». We are already on `plugins_loaded` here, so the
	 * right thing is to do the work rather than to ask to be called back.
	 */
	public static function init(): void {
		add_action( 'admin_notices', array( self::class, 'notice' ) );
		self::auto();
	}

	// ── The steps ────────────────────────────────────────────────────────────

	/**
	 * Every step there has ever been, in order, oldest first.
	 *
	 * Ids are permanent. Never renumber and never reuse: the id is what an
	 * install records, so changing one makes every existing install re-run a
	 * step it has already had, or skip one it has not.
	 *
	 * @return array<int, array{id:int, label:string, auto:bool, run:callable}>
	 */
	public static function steps(): array {
		return array(
			array(
				'id'    => 1,
				'label' => 'Table de séquence des numéros de document',
				'auto'  => true,
				'run'   => array( self::class, 'step_sequence_table' ),
			),
			array(
				'id'    => 2,
				'label' => 'Table du journal des messages sortants',
				'auto'  => true,
				'run'   => array( self::class, 'step_mail_table' ),
			),
			array(
				'id'    => 3,
				'label' => 'Fusion des deux marqueurs de version hérités',
				'auto'  => true,
				'run'   => array( self::class, 'step_fold_legacy_markers' ),
			),
			array(
				'id'    => 4,
				'label' => 'Dépôt local du catalogue fournisseur',
				'auto'  => true,
				'run'   => array( self::class, 'step_supply_table' ),
			),
			array(
				'id'    => 5,
				'label' => 'Table des prix et disponibilités par article',
				'auto'  => true,
				'run'   => array( self::class, 'step_dispo_table' ),
			),
			array(
				'id'    => 6,
				'label' => 'Identité légale de PHARAON SAS et de l’hébergeur',
				'auto'  => true,
				'run'   => array( self::class, 'step_identite' ),
			),
			/*
			 * 7 ET 8 NE SONT PAS `auto`, et ce n'est pas une question de durée : ils
			 * écrivent des pages et des menus, et `auto()` tourne sur
			 * `plugins_loaded`, avant `init`, donc avant que WordPress ait enregistré
			 * le type « page » et la taxonomie des menus, et avant que les autres
			 * extensions aient posé leurs crochets de sauvegarde. `wp teeshoop
			 * migrer`, que l'installation d'un déploiement lance, les joue une fois
			 * WordPress entièrement chargé.
			 */
			array(
				'id'    => 7,
				'label' => 'Pages vides de l’ancienne installation, retirées du site et des menus',
				'auto'  => false,
				'run'   => array( self::class, 'step_pages_vides' ),
			),
			array(
				'id'    => 8,
				'label' => 'Page de demande de devis',
				'auto'  => false,
				'run'   => array( self::class, 'step_page_devis' ),
			),
			// Même raison que 7 et 8, plus une : désactiver une extension demande
			// les fonctions d'administration de WordPress, chargées après `init`.
			array(
				'id'    => 9,
				'label' => 'Restes de l’ancienne installation : Rank Math et trois pages',
				'auto'  => false,
				'run'   => array( self::class, 'step_restes_ancienne_installation' ),
			),
			// Une option, rien d'autre : l'API des options existe dès `plugins_loaded`.
			array(
				'id'    => 10,
				'label' => 'Fuseau horaire de Paris, heure d’été comprise',
				'auto'  => true,
				'run'   => array( self::class, 'step_fuseau' ),
			),
		);
	}

	/**
	 * Le fuseau du site : Europe/Paris, quand aucun fuseau nommé n'est choisi.
	 *
	 * LA PRODUCTION TOURNAIT EN UTC+1 FIXE (« gmt_offset »: 1, « timezone_string »
	 * vide, lu sur /wp-json/ le 26/09/2026), donc sans heure d'été : un bon à tirer
	 * validé à 15 h 30 à Paris était daté 14 h 30 sur la page, dans le courriel et
	 * sur la copie PDF qui sert de preuve, et un encaissement saisi entre minuit et
	 * une heure l'était de la veille (CMD-03). Tout le domaine passe par
	 * `wp_date()`, donc la cause est ce réglage et c'est lui qu'on pose.
	 *
	 * UN FUSEAU NOMMÉ DÉJÀ CHOISI N'EST PAS RÉÉCRIT : il a été décidé par quelqu'un.
	 * Un décalage fixe ou rien du tout ne l'a été par personne.
	 */
	public static function step_fuseau(): string {
		if ( '' !== (string) get_option( 'timezone_string', '' ) ) {
			return 'déjà nommé : ' . (string) get_option( 'timezone_string' );
		}
		update_option( 'timezone_string', 'Europe/Paris' );
		return 'Europe/Paris';
	}

	/**
	 * L'identité que les mentions légales, le pied de page et les factures lisent.
	 *
	 * POURQUOI UNE MIGRATION. Personne n'a accès à l'administration de la
	 * production (décision du 26/09/2026) : l'écran qui écrit cette option n'a donc
	 * pas d'utilisateur, et chaque page du site affichait « Identité légale non
	 * renseignée » alors que l'associé l'avait fournie le 01/09.
	 *
	 * D'OÙ VIENT CHAQUE VALEUR, pour qu'aucune ne soit reconstituée :
	 *   - l'éditeur : réponse 17 de l'associé, recoupée le 26/09/2026 avec le
	 *     registre SIRENE (recherche-entreprises.api.gouv.fr, SIREN 930 592 985) :
	 *     PHARAON, SAS, un seul établissement, son siège, 97 avenue de Castelnau à
	 *     Drancy. Le siège est celui du registre et pas l'atelier de Bobigny : un
	 *     SIRET désigne une adresse, et en publier une autre rendrait la mention
	 *     fausse. Bobigny est la ville du greffe, ce que dit `rcs_ville` ;
	 *   - le directeur de la publication, l'e-mail et le téléphone publics :
	 *     réponse 56 ;
	 *   - l'hébergeur : ce qu'o2switch demande lui-même de publier
	 *     (blog.o2switch.fr, « Que renseigner dans la page Mentions légales »).
	 *
	 * UN CHAMP DÉJÀ REMPLI N'EST JAMAIS RÉÉCRIT : ce qu'un opérateur a saisi gagne,
	 * et c'est aussi ce qui rend l'étape idempotente.
	 */
	public static function step_identite(): string {
		$voulu = array(
			'raison_sociale'        => 'PHARAON',
			'forme_juridique'       => 'SAS',
			'capital'               => '100 EUR',
			'adresse'               => '97 avenue de Castelnau',
			'code_postal'           => '93700',
			'ville'                 => 'Drancy',
			'siret'                 => '93059298500012',
			'rcs_ville'             => 'Bobigny',
			'tva_intra'             => 'FR45930592985',
			'directeur_publication' => 'SINGH Simran',
			'contact_email'         => 'legales@teeshoop.fr',
			'contact_tel'           => '07 58 48 83 98',
			'hebergeur_nom'         => 'o2switch',
			'hebergeur_adresse'     => 'Chemin des Pardiaux',
			'hebergeur_ville'       => '63000 Clermont-Ferrand',
			'hebergeur_tel'         => '04 44 44 60 40',
		);
		$actuel = get_option( OPTION_LEGAL, array() );
		if ( ! is_array( $actuel ) ) {
			$actuel = array();
		}
		$poses = array();
		foreach ( $voulu as $cle => $valeur ) {
			if ( '' === trim( (string) ( $actuel[ $cle ] ?? '' ) ) ) {
				$actuel[ $cle ] = $valeur;
				$poses[]        = $cle;
			}
		}
		if ( array() === $poses ) {
			return 'identité déjà renseignée, rien de réécrit';
		}
		update_option( OPTION_LEGAL, $actuel );
		return sprintf( '%d champ(s) posé(s) : %s', count( $poses ), implode( ', ', $poses ) );
	}

	/**
	 * Les pages de l'ancienne installation qui ne s'affichent plus.
	 *
	 * Mesuré en production le 26/09/2026 : sous notre thème, Services, Suivi de
	 * commande, À propos, Contact et Devis gratuit n'affichent que leur titre, et
	 * les trois premières sont dans le menu principal. Décision de l'utilisateur :
	 * les retirer pour l'instant, elles seront refaites.
	 *
	 * EN BROUILLON, PAS À LA CORBEILLE : leur contenu reste en base pour être
	 * repris. Leurs entrées de menu, elles, sont supprimées, parce qu'un menu
	 * WordPress continue d'afficher le lien vers une page en brouillon, et ce lien
	 * rend une 404 à chaque visiteur.
	 *
	 * UNE PAGE QUI A UN VRAI TEXTE N'EST PAS TOUCHÉE, sauf si c'est une page
	 * Elementor, dont le contenu ne passe pas par notre thème : sur un autre
	 * environnement, une page « contact » écrite à la main reste en ligne.
	 */
	public static function step_pages_vides(): string {
		$retirees = array();
		foreach ( array( 'services', 'suivi', 'a-propos', 'contact', 'devis-gratuit' ) as $slug ) {
			$page = get_page_by_path( $slug );
			if ( ! $page instanceof \WP_Post || 'publish' !== $page->post_status ) {
				continue;
			}
			$texte     = trim( wp_strip_all_tags( strip_shortcodes( (string) $page->post_content ) ) );
			$elementor = 'builder' === get_post_meta( $page->ID, '_elementor_edit_mode', true );
			if ( ! $elementor && mb_strlen( $texte ) >= 200 ) {
				continue;
			}
			self::retirer_page( $page );
			$retirees[] = $slug;
		}
		return array() === $retirees
			? 'aucune page vide à retirer'
			: sprintf( '%d page(s) en brouillon et retirée(s) des menus : %s', count( $retirees ), implode( ', ', $retirees ) );
	}

	/**
	 * Ce que l'ancienne installation publie encore et qui n'est pas Teeshoop.
	 *
	 * RANK MATH, gratuit et PRO. Mesuré en production le 26/09/2026 : il émet un
	 * premier jeu de balises de partage avant le nôtre, avec « TeeShoop » pour
	 * nom, une photographie de 2025 pour image et la vidéo de démonstration de
	 * meubles du thème d'origine (`wd-furniture-hotspot-video.mp4`), et un graphe
	 * JSON-LD qui nomme une personne « adminder ». Les réseaux retiennent en
	 * général la première balise. `Seo.php` a été écrit pour se passer de lui (voir
	 * son en-tête) et tient déjà titres, descriptions, canonique, robots, graphe et
	 * plan du site. Reconnu par le nom de son en-tête et non par un chemin, qui
	 * diffère entre la version gratuite et la PRO.
	 *
	 * TROIS PAGES qui ne sont pas vides mais contredisent les nôtres, ou promettent
	 * ce que la boutique ne vend pas : une politique de remboursement générique
	 * (« 14 jours, article inutilisé ») face à des articles personnalisés, que
	 * nos conditions générales traitent ; une seconde politique de cookies, face à
	 * celle que `LegalPage` publie ; des cartes cadeaux, que la boutique ne vend
	 * pas. En brouillon, comme à l'étape 7.
	 */
	public static function step_restes_ancienne_installation(): string {
		$fait = array();

		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$extensions = array();
		foreach ( get_plugins() as $fichier => $entete ) {
			if ( str_starts_with( (string) ( $entete['Name'] ?? '' ), 'Rank Math' ) && is_plugin_active( $fichier ) ) {
				$extensions[] = $fichier;
			}
		}
		if ( array() !== $extensions ) {
			deactivate_plugins( $extensions );
			$fait[] = 'extension(s) désactivée(s) : ' . implode( ', ', $extensions );
		}

		$pages = array();
		foreach ( array( 'remboursement', 'cookies', 'cartes-cadeaux' ) as $slug ) {
			$page = get_page_by_path( $slug );
			if ( $page instanceof \WP_Post && 'publish' === $page->post_status ) {
				self::retirer_page( $page );
				$pages[] = $slug;
			}
		}
		if ( array() !== $pages ) {
			$fait[] = 'page(s) en brouillon et retirée(s) des menus : ' . implode( ', ', $pages );
		}

		return array() === $fait ? 'rien de l’ancienne installation à retirer' : implode( ' ; ', $fait );
	}

	/**
	 * Une page en brouillon, et ses entrées de menu supprimées : un menu WordPress
	 * continue d'afficher le lien vers une page en brouillon, qui rend une 404 à
	 * chaque visiteur. Le contenu, lui, reste en base pour être repris.
	 */
	private static function retirer_page( \WP_Post $page ): void {
		$fait = wp_update_post( array( 'ID' => $page->ID, 'post_status' => 'draft' ), true );
		if ( is_wp_error( $fait ) ) {
			throw new \RuntimeException( sprintf( 'la page %s n’a pas pu passer en brouillon : %s', $page->post_name, $fait->get_error_message() ) );
		}
		foreach ( wp_get_associated_nav_menu_items( $page->ID, 'post_type', 'page' ) as $item ) {
			wp_delete_post( (int) $item, true );
		}
	}

	/**
	 * La page que les boutons « Devis » ouvrent.
	 *
	 * Son contenu vient du gabarit `page-devis.php` du thème, que WordPress lui
	 * applique par son adresse. Sans elle, `quote_url()` retombait sur la boutique,
	 * et en production chaque bouton « Devis » menait au catalogue.
	 *
	 * Même titre et même règle que `Cli::ensure_site_pages()` : publiée sous notre
	 * thème, en brouillon sous un autre, où elle ne serait qu'un titre.
	 */
	public static function step_page_devis(): string {
		$statut = 'teeshoop' === get_template() ? 'publish' : 'draft';
		$page   = get_page_by_path( 'devis' );
		if ( $page instanceof \WP_Post ) {
			if ( 'publish' === $page->post_status || 'publish' !== $statut ) {
				return 'page devis déjà présente';
			}
			$fait = wp_update_post( array( 'ID' => $page->ID, 'post_status' => 'publish' ), true );
			if ( is_wp_error( $fait ) ) {
				throw new \RuntimeException( 'la page devis n’a pas pu être publiée : ' . $fait->get_error_message() );
			}
			return 'page devis publiée';
		}
		$id = wp_insert_post(
			array(
				'post_type'      => 'page',
				'post_status'    => $statut,
				'post_title'     => 'Un devis pour votre projet',
				'post_name'      => 'devis',
				'post_content'   => '',
				'comment_status' => 'closed',
				'ping_status'    => 'closed',
			),
			true
		);
		if ( is_wp_error( $id ) ) {
			throw new \RuntimeException( 'la page devis n’a pas pu être créée : ' . $id->get_error_message() );
		}
		return 'publish' === $statut ? 'page devis créée' : 'page devis créée en brouillon, le thème actif n’est pas teeshoop';
	}

	/**
	 * Le dépôt local du catalogue fournisseur.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * POURQUOI UNE TABLE ET PAS DES APPELS À LA DEMANDE
	 *
	 * Mesuré le 9 septembre 2026 contre le service : le catalogue complet fait
	 * 3 241 produits sur 65 pages, 94,1 s et 250,2 Mo, et il n'existe AUCUN point
	 * d'entrée par référence. « Donne-moi BC01B » n'est pas une question que ce
	 * service sait entendre : il faut marcher les 65 pages.
	 *
	 * La charge utile est stockée COMPRESSÉE et ENTIÈRE. Mesuré aussi : 254,2 Mo
	 * de JSON deviennent 8,1 Mo compressés, soit 2,5 ko par produit. Garder tout
	 * plutôt qu'un extrait coûte 2,8 Mo de plus et paie de ne jamais remarcher le
	 * fournisseur quand la cartographie change.
	 */
	public static function step_supply_table(): string {
		global $wpdb;
		$table  = Supply::table();
		$before = self::table_exists( $table );
		Supply::install();
		if ( ! self::table_exists( $table ) ) {
			throw new \RuntimeException( sprintf( 'la table %s n’existe toujours pas après le CREATE : %s', $table, (string) $wpdb->last_error ) );
		}
		return $before ? 'déjà présente' : 'créée';
	}

	/**
	 * Les prix et disponibilités par article, tenus à jour par balayage.
	 *
	 * Le service ne rend le prix ET le stock que sur une seule route, à 0,43 s
	 * de socle plus 0,068 s par code (mesuré sur sept points, régression
	 * linéaire). Une fiche produit ne peut donc pas l'appeler pendant qu'elle
	 * s'affiche, et une liste encore moins. Cette table est ce qu'elle lit, et
	 * `Disponibilite::assert_buyable()` est le seul endroit qui redemande au
	 * fournisseur, au moment où l'on vend.
	 */
	public static function step_dispo_table(): string {
		global $wpdb;
		$table  = Disponibilite::table();
		$before = self::table_exists( $table );
		Disponibilite::install();
		if ( ! self::table_exists( $table ) ) {
			throw new \RuntimeException( sprintf( 'la table %s n’existe toujours pas après le CREATE : %s', $table, (string) $wpdb->last_error ) );
		}
		return $before ? 'déjà présente' : 'créée';
	}

	/**
	 * The sequence table behind document numbering.
	 *
	 * Moved here verbatim from Invoice::install(), including the reason there is
	 * no auto-increment column: the number comes from `LAST_INSERT_ID(expr)`, so
	 * an InnoDB auto-increment gap left by a failed insert cannot become a hole
	 * in a legally continuous sequence.
	 *
	 * The charset is now `get_charset_collate()` rather than a hardcoded
	 * `utf8mb4`. The old literal ignored the collation the rest of the database
	 * uses, which is how a JOIN against another table starts erroring about
	 * mixed collations on a host whose default is not ours.
	 */
	public static function step_sequence_table(): string {
		global $wpdb;
		$table   = Invoice::table();
		$collate = $wpdb->get_charset_collate();
		$before  = self::table_exists( $table );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"CREATE TABLE IF NOT EXISTS {$table} (
				series VARCHAR(32) NOT NULL,
				next_number BIGINT UNSIGNED NOT NULL,
				PRIMARY KEY (series)
			) {$collate}"
		);
		if ( ! self::table_exists( $table ) ) {
			throw new \RuntimeException( sprintf( 'la table %s n’existe toujours pas après le CREATE : %s', $table, (string) $wpdb->last_error ) );
		}
		return $before ? 'déjà présente' : 'créée';
	}

	/** The outbox behind Mail. Moved verbatim from Mail::install(). */
	public static function step_mail_table(): string {
		global $wpdb;
		$table   = Mail::table();
		$collate = $wpdb->get_charset_collate();
		$before  = self::table_exists( $table );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"CREATE TABLE IF NOT EXISTS {$table} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				created_at DATETIME NOT NULL,
				sent_at DATETIME NULL,
				kind VARCHAR(40) NOT NULL,
				order_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
				recipient VARCHAR(190) NOT NULL,
				subject VARCHAR(255) NOT NULL,
				status VARCHAR(16) NOT NULL,
				attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
				transport VARCHAR(16) NOT NULL DEFAULT '',
				message_id VARCHAR(120) NOT NULL DEFAULT '',
				last_error TEXT NULL,
				PRIMARY KEY (id),
				KEY status_created (status, created_at),
				KEY order_kind (order_id, kind)
			) {$collate}"
		);
		if ( ! self::table_exists( $table ) ) {
			throw new \RuntimeException( sprintf( 'la table %s n’existe toujours pas après le CREATE : %s', $table, (string) $wpdb->last_error ) );
		}
		return $before ? 'déjà présente' : 'créée';
	}

	/**
	 * Remove the two per-table marker options the lazy installers wrote.
	 *
	 * They are not deleted for tidiness. `teeshoop_db_version` is a plugin-wide
	 * name holding a per-table value, and leaving it there would leave two
	 * answers to « what version is this database », which is the class of thing
	 * this file exists to end. Deleting an absent option is a no-op, so this is
	 * idempotent by construction.
	 */
	public static function step_fold_legacy_markers(): string {
		$removed = array();
		foreach ( array( 'teeshoop_db_version', 'teeshoop_mail_db' ) as $legacy ) {
			if ( false !== get_option( $legacy, false ) ) {
				delete_option( $legacy );
				$removed[] = $legacy;
			}
		}
		return array() === $removed
			? 'aucun marqueur hérité à retirer'
			: sprintf( '%d marqueur(s) retiré(s) : %s', count( $removed ), implode( ', ', $removed ) );
	}

	// ── The runner ───────────────────────────────────────────────────────────

	/** The highest step that exists in this copy of the code. */
	public static function target(): int {
		$max = 0;
		foreach ( self::steps() as $step ) {
			$max = max( $max, (int) $step['id'] );
		}
		return $max;
	}

	/** The version this database is at. 0 means « nothing has ever run ». */
	public static function current(): int {
		$state = get_option( self::OPTION, array() );
		return is_array( $state ) ? max( 0, (int) ( $state['version'] ?? 0 ) ) : 0;
	}

	public static function pending(): bool {
		return self::current() < self::target();
	}

	/** The steps this database has not had, in order. */
	/**
	 * Les étapes que cette base n'a pas eues, dans l'ordre.
	 *
	 * Passe par `plan()` plutôt que de refaire la boucle : c'était la MÊME règle
	 * écrite à deux endroits, et l'une des deux triait par identifiant pendant que
	 * l'autre suivait l'ordre de déclaration. Le jour où quelqu'un insère une
	 * étape au milieu de `steps()`, `status()` l'annonçait dans le désordre
	 * pendant que `migrate()` la jouait dans le bon. `cli` à true parce que cette
	 * liste répond « qu'est-ce qui reste », pas « qu'est-ce qui peut tourner ici ».
	 */
	public static function outstanding(): array {
		return self::plan( self::steps(), self::current(), true )['run'];
	}

	/**
	 * WHICH STEPS RUN, AND WHERE THE RUN STOPS. Pure: no database, no options,
	 * no WordPress at all, which is why tests/test-schema.php can exercise every
	 * branch of it in `php tests/run.php` with no bootstrap.
	 *
	 * THE ONE RULE THAT IS NOT OBVIOUS: a step that may not run STOPS the run, it
	 * does not get skipped over. Steps are ordered and a later one may depend on
	 * an earlier one, so running 5 because 4 was command-line-only would leave
	 * the database in a shape no version describes. Stopping leaves it at 3,
	 * which is a state the next run can resume from.
	 *
	 * @param array $steps every step, in order
	 * @param int   $at    the version the database is at
	 * @param bool  $cli   whether steps that are not `auto` are permitted
	 *
	 * @return array{run:array, stopped:?array}
	 */
	public static function plan( array $steps, int $at, bool $cli ): array {
		$run     = array();
		$stopped = null;
		/*
		 * SORTED BY ID, not trusted to be declared in order. The order steps run
		 * in is the whole contract, and leaving it to whoever edits steps() means
		 * the day somebody inserts a new step in the middle of the list rather
		 * than at the end, it runs before the ones it depends on. Sorting here
		 * makes the invariant a fact instead of a convention.
		 */
		usort( $steps, static fn( array $a, array $b ): int => (int) $a['id'] <=> (int) $b['id'] );
		foreach ( $steps as $step ) {
			if ( (int) $step['id'] <= $at ) {
				continue;
			}
			if ( ! $cli && empty( $step['auto'] ) ) {
				$stopped = $step;
				break;
			}
			$run[] = $step;
		}
		return array( 'run' => $run, 'stopped' => $stopped );
	}

	/**
	 * What a deploy log and the admin screen both read.
	 *
	 * @return array{current:int, target:int, pending:int, cli_only:int, steps:array}
	 */
	public static function status(): array {
		$out      = self::outstanding();
		$cli_only = array_values( array_filter( $out, static fn( array $s ): bool => empty( $s['auto'] ) ) );
		$state    = get_option( self::OPTION, array() );
		return array(
			'current'  => self::current(),
			'target'   => self::target(),
			'pending'  => count( $out ),
			'cli_only' => count( $cli_only ),
			'history'  => is_array( $state ) ? (array) ( $state['history'] ?? array() ) : array(),
			'steps'    => array_map(
				static fn( array $s ): array => array(
					'id'    => (int) $s['id'],
					'label' => (string) $s['label'],
					'auto'  => ! empty( $s['auto'] ),
				),
				$out
			),
		);
	}

	/**
	 * Run what is outstanding.
	 *
	 * @param array{dry?:bool, redo?:bool, cli?:bool} $opts
	 *   dry   report and write nothing at all, not even the version
	 *   redo  run every step again from 1, for repairing an install by hand
	 *   cli   permit steps that are not `auto`
	 *
	 * @return array{ok:bool, from:int, to:int, dry:bool, ran:array, skipped:array, error:string}
	 */
	public static function migrate( array $opts = array() ): array {
		$dry  = ! empty( $opts['dry'] );
		$redo = ! empty( $opts['redo'] );
		$cli  = ! empty( $opts['cli'] );

		$from = self::current();
		$plan = self::plan( self::steps(), $redo ? 0 : $from, $cli );
		/*
		 * `redo` re-runs from the first step and must NOT move the recorded
		 * version backwards on the way: `$at` starts at the version the database
		 * already has, so a repair of an install at 3 stays at 3 throughout.
		 */
		$steps   = $plan['run'];
		$ran     = array();
		$skipped = null === $plan['stopped'] ? array() : array( array( 'id' => (int) $plan['stopped']['id'], 'label' => (string) $plan['stopped']['label'] ) );

		if ( array() === $steps && array() === $skipped ) {
			return array( 'ok' => true, 'from' => $from, 'to' => $from, 'dry' => $dry, 'ran' => array(), 'skipped' => array(), 'error' => '' );
		}

		/*
		 * FAIL CLOSED ON A HELD LOCK. Not « wait »: if another process is
		 * migrating, this one has nothing useful to add and saying so is more
		 * honest than a second writer racing the first. A dry run does not take
		 * the lock, because it writes nothing.
		 */
		if ( ! $dry ) {
			/*
			 * LE VERROU EST UN INSERT, PAS UN « LIRE PUIS ÉCRIRE ».
			 *
			 * C'était `get_transient` puis `set_transient`, deux opérations
			 * séparées : deux requêtes concurrentes lisaient toutes les deux
			 * « libre » et posaient toutes les deux le verrou. Sur une boutique
			 * qui reçoit des robots, deux requêtes à la même seconde n'ont rien
			 * d'improbable. `add_option()` fait un INSERT sur `option_name`, qui
			 * porte un index unique : une seule des deux peut réussir, et c'est
			 * la base de données qui tranche. Le test qui couvrait ce verrou ne
			 * pouvait pas voir la différence, parce qu'il est séquentiel.
			 *
			 * `autoload` à off : ce verrou ne doit pas être chargé sur chaque
			 * requête alors qu'il n'existe que quelques secondes par an.
			 *
			 * ET PAS `add_option()`, QUI N'EN EST PAS UN (DON-08). Il lit
			 * l'option, puis écrit par INSERT … ON DUPLICATE KEY UPDATE : deux
			 * requêtes qui lisent « absent » réussissent toutes les deux, et la
			 * première qui finit supprimait le verrou de l'autre. `INSERT IGNORE`
			 * dit par son nombre de lignes qui a gagné, et le cache d'objets
			 * n'entre pas dans la décision.
			 */
			global $wpdb;
			$maintenant = time();
			$pris       = 1 === (int) $wpdb->query(
				$wpdb->prepare( "INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'off')", self::LOCK, (string) $maintenant )
			);
			if ( ! $pris ) {
				$tenu = (int) $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", self::LOCK ) );
				if ( $tenu > 0 && ( $maintenant - $tenu ) < self::LOCK_SECONDS ) {
					return array(
						'ok'      => false,
						'from'    => $from,
						'to'      => $from,
						'dry'     => false,
						'ran'     => array(),
						'skipped' => array(),
						'error'   => 'une migration est déjà en cours (verrou ' . self::LOCK . '). Rien n’a été fait.',
					);
				}
				/*
				 * Le verrou est plus vieux que la plus longue migration possible :
				 * le processus qui le tenait est mort. On le reprend, par
				 * comparaison et échange : seul celui qui remplace la valeur qu'il
				 * a lue le reprend, un second repreneur ne touche aucune ligne.
				 */
				$repris = 1 === (int) $wpdb->query(
					$wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s", (string) $maintenant, self::LOCK, (string) $tenu )
				);
				if ( ! $repris ) {
					return array(
						'ok'      => false,
						'from'    => $from,
						'to'      => $from,
						'dry'     => false,
						'ran'     => array(),
						'skipped' => array(),
						'error'   => 'une migration est déjà en cours (verrou ' . self::LOCK . ' repris par un autre processus). Rien n’a été fait.',
					);
				}
			}
			wp_cache_delete( self::LOCK, 'options' );
		}

		$at    = $from;
		$error = '';
		$doing = 0;
		try {
			foreach ( $steps as $step ) {
				$id    = (int) $step['id'];
				$doing = $id;
				if ( $dry ) {
					$ran[] = array( 'id' => $id, 'label' => (string) $step['label'], 'did' => 'à blanc, rien exécuté' );
					$at    = max( $at, $id );
					continue;
				}
				$did = (string) call_user_func( $step['run'] );
				$ran[] = array( 'id' => $id, 'label' => (string) $step['label'], 'did' => $did );
				$at    = max( $at, $id );
				self::record( $at, $id );
			}
		} catch ( \Throwable $e ) {
			/*
			 * The version is recorded step by step above, not once at the end,
			 * so a failure halfway leaves the database at the last step that
			 * actually completed and the next run resumes there. Recording the
			 * target at the end would mark unfinished work as done.
			 */
			/*
			 * The id of the step that threw, not `$at + 1`. Ids are permanent and
			 * never reused, so removing a step one day leaves a gap and `$at + 1`
			 * would name a step that does not exist, in the one message somebody
			 * reads when a deploy has just failed.
			 */
			$error = sprintf( 'étape %d interrompue : %s', $doing, $e->getMessage() );
		} finally {
			if ( ! $dry ) {
				// Le sien seulement : un verrou repris entre-temps par un autre reste à lui.
				$wpdb->delete( $wpdb->options, array( 'option_name' => self::LOCK, 'option_value' => (string) $maintenant ) );
				wp_cache_delete( self::LOCK, 'options' );
			}
		}

		return array(
			'ok'      => '' === $error,
			'from'    => $from,
			'to'      => $at,
			'dry'     => $dry,
			'ran'     => $ran,
			'skipped' => $skipped,
			'error'   => $error,
		);
	}

	/** Write the version and stamp the step, with `autoload` on: every request reads it. */
	private static function record( int $version, int $step ): void {
		$state = get_option( self::OPTION, array() );
		if ( ! is_array( $state ) ) {
			$state = array();
		}
		$history              = is_array( $state['history'] ?? null ) ? $state['history'] : array();
		$history[ (string) $step ] = gmdate( 'c' );
		update_option(
			self::OPTION,
			array(
				'version' => $version,
				'history' => $history,
				'plugin'  => VERSION,
				'at'      => gmdate( 'c' ),
			),
			true
		);
	}

	/**
	 * The net, on every request, for `auto` steps only.
	 *
	 * `pending()` is one option read, and the option is autoloaded, so this
	 * costs nothing on a site that is up to date. When it is not up to date it
	 * runs the O(1) steps and stops at the first that is not, which is the case
	 * `notice()` then tells an administrator about.
	 */
	public static function auto(): void {
		if ( ! self::pending() ) {
			return;
		}

		/*
		 * UNE ÉTAPE QUI ÉCHOUE NE DOIT PAS ÊTRE RÉESSAYÉE À CHAQUE REQUÊTE.
		 *
		 * Ce corps était `if pending -> migrate`, et le rapport de `migrate()`
		 * était jeté. Une étape qui échoue toujours (une table qu'on n'a pas le
		 * droit de créer, un disque plein) laissait donc la version en arrière,
		 * donc `pending()` restait vrai, donc chaque page du site relançait la
		 * migration, indéfiniment, sans que rien nulle part ne le dise. Sur un
		 * hébergement mutualisé c'est une requête SQL en échec par visiteur.
		 * Trouvé par une relecture adverse avant le premier déploiement.
		 *
		 * L'échec est donc mémorisé et on n'y revient pas avant un quart d'heure,
		 * ce qui laisse le temps à un administrateur de lire l'avertissement, et
		 * à `wp teeshoop migrer` de retenter tout de suite sans attendre (il ne
		 * passe pas par ici).
		 */
		$etat = get_option( self::OPTION, array() );
		$dernier = is_array( $etat ) ? (int) ( $etat['echec_at'] ?? 0 ) : 0;
		if ( $dernier > 0 && ( time() - $dernier ) < 15 * MINUTE_IN_SECONDS ) {
			return;
		}

		/*
		 * `auto` SEULEMENT, MÊME SOUS WP-CLI. C'était `'cli' => WP_CLI` : sous
		 * WP-CLI, ce filet jouait aussi les étapes réservées à la ligne de
		 * commande, sur `plugins_loaded`, c'est-à-dire avant `init`. Tant que
		 * toutes les étapes créaient des tables, personne ne le voyait. Mais
		 * `wp teeshoop migrer`, le chemin du déploiement, charge WordPress avant
		 * de s'exécuter : ce filet passait le premier, jouait tout avant `init`,
		 * et la commande ne trouvait plus rien à faire.
		 */
		$rapport = self::migrate( array() );
		if ( ! $rapport['ok'] ) {
			self::note_echec( (string) $rapport['error'] );
		} elseif ( $dernier > 0 ) {
			self::note_echec( '' );
		}
	}

	/** Garder (ou effacer) la trace du dernier échec, pour l'avertissement et le recul. */
	private static function note_echec( string $message ): void {
		$etat = get_option( self::OPTION, array() );
		if ( ! is_array( $etat ) ) {
			$etat = array();
		}
		if ( '' === $message ) {
			unset( $etat['echec'], $etat['echec_at'] );
		} else {
			$etat['echec']    = $message;
			$etat['echec_at'] = time();
		}
		update_option( self::OPTION, $etat, true );
	}

	/**
	 * Say so in the admin when a step is waiting for the command line.
	 *
	 * A migration that cannot run and does not say so is worse than one that
	 * fails: the shop keeps serving with a schema the code does not expect.
	 */
	public static function notice(): void {
		if ( ! self::pending() || ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$status = self::status();
		$etat   = get_option( self::OPTION, array() );
		$echec  = is_array( $etat ) ? (string) ( $etat['echec'] ?? '' ) : '';
		printf(
			'<div class="notice notice-%s"><p><strong>Teeshoop</strong> : la base est en version %d et le code en attend %d. %d étape(s) en attente.%s Lancez <code>wp teeshoop migrer</code> en ligne de commande.</p></div>',
			'' === $echec ? 'warning' : 'error',
			(int) $status['current'],
			(int) $status['target'],
			(int) $status['pending'],
			'' === $echec ? '' : ' <strong>La dernière tentative a échoué :</strong> ' . esc_html( $echec ) . '.'
		);
	}

	private static function table_exists( string $table ): bool {
		global $wpdb;
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return (string) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) === $table;
	}
}
