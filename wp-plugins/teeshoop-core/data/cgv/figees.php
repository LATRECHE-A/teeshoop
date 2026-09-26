<?php
/**
 * Les empreintes des versions de CGV qui ne sont plus en vigueur.
 *
 * Une version périmée est un contrat que des clients ont accepté. Elle ne se
 * corrige pas : on en publie une nouvelle, datée du jour où elle prend effet, et
 * l'ancienne reste sur le disque exactement telle qu'elle était. Rien ne tenait
 * cette promesse jusqu'ici. `tests/test-terms.php` compare désormais chaque
 * version périmée à son empreinte, et **refuse une version périmée qui n'est pas
 * dans cette liste** : oublier d'en inscrire une doit être plus bruyant que d'en
 * inscrire une fausse, parce qu'une entrée manquante est un contrat que rien ne
 * surveille.
 *
 * L'empreinte porte sur le FICHIER ENTIER, commentaires compris, pas sur le
 * texte rendu. Ce qui est gelé, c'est aussi le raisonnement : quelqu'un qui
 * relira dans dix-huit mois ce qu'un acheteur a accepté ouvre ce fichier.
 *
 * Ajouter une ligne ici est la seconde moitié de « publier une nouvelle
 * version », jamais un geste séparé.
 *
 * @package Teeshoop\Core
 */

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

return array(
	// Périmée le 1er septembre 2026, remplacée par 2026-09-01 (questions 01, 07,
	// 14 et 16 : le minimum en euros, le franco, le délai et l'acompte).
	'2026-08-26' => 'c5c42aabb170a5a60ef6d51b77f7d42ccc02293d52d7d91c8d90b9873745adf7',
	// Périmée le 26 septembre 2026, remplacée par 2026-09-26 : le seuil de devis
	// en montant porte sur la commande entière, pas sur une ligne (question 02).
	'2026-09-01' => 'efbf2c1d90a68c6764f11f975831e0ec2e6c55913c2de1b69fa3a26aef196da2',
);
