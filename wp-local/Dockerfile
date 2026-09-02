# The mirror's WordPress, plus the two PHP extensions production has and the
# official image does not.
#
# WHY THIS EXISTS. o2switch runs Redis and memcached on the account (both
# restarted by its own crontab, socket at ~/.cpanel/redis/redis.sock) and `php -m`
# there lists redis, memcached and igbinary. The official `wordpress:` images
# ship none of them, so an object cache drop-in could be written, deployed and
# never once exercised before a customer met it. That is the class of claim this
# project does not make: an object cache is a thing that can serve one visitor
# another visitor's basket, and it has to be testable HERE.
#
# The base tag is still pinned to production's WordPress. See the header of
# docker-compose.yml before changing it.
#
# igbinary first, because the redis extension is built AGAINST it: without it
# `redis.serializer = igbinary` is not available, and that is the serializer the
# drop-in uses. The build dependencies are removed again in the same layer so the
# image does not carry a compiler.
#
# The configure options are passed rather than answered on stdin, which is a
# correction: piping fixed answers into `pecl install` depends on the order the
# prompts happen to be asked in, and this extension asks about igbinary, lzf,
# zstd, msgpack and lz4. Feeding the wrong "yes" to msgpack failed the build
# looking for php_msgpack.h. Naming each option leaves nothing to the order.
FROM wordpress:7.1-php8.3-apache

RUN set -eux; \
	apt-get update; \
	apt-get install -y --no-install-recommends $PHPIZE_DEPS; \
	pecl install igbinary; \
	docker-php-ext-enable igbinary; \
	pecl install --configureoptions 'enable-redis-igbinary="yes" enable-redis-lzf="no" enable-redis-zstd="no" enable-redis-msgpack="no" enable-redis-lz4="no"' redis; \
	docker-php-ext-enable redis; \
	apt-get purge -y --auto-remove $PHPIZE_DEPS; \
	rm -rf /var/lib/apt/lists/* /tmp/pear
