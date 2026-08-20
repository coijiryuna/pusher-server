CREATE TABLE `apps` (
  `id` varchar(255) NOT NULL,
  `key` varchar(255) NOT NULL,
  `secret` varchar(255) NOT NULL,
  `cluster` varchar(255) DEFAULT 'appcluster',
  `max_connections` int(11) DEFAULT -1,
  `enable_client_messages` tinyint(1) DEFAULT 0,
  `enabled` tinyint(1) DEFAULT 1,
  `max_backend_events_per_sec` int(11) DEFAULT -1,
  `max_client_events_per_sec` int(11) DEFAULT -1,
  `max_read_req_per_sec` int(11) DEFAULT -1,
  `webhooks` text DEFAULT '[]',
  `ip_whitelist` text DEFAULT '[]',
  `user_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`)
);

CREATE TABLE `user` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` varchar(20) DEFAULT 'operator',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
);

CREATE TABLE `event_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `app_id` varchar(255) NOT NULL,
  `channel` varchar(255) NOT NULL,
  `event` varchar(255) NOT NULL,
  `payload` text DEFAULT NULL,
  `status` varchar(20) DEFAULT 'success',
  `error` text DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `app_id` (`app_id`)
);

CREATE TABLE `audit_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `action` varchar(255) NOT NULL,
  `target` varchar(255) DEFAULT NULL,
  `detail` text DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`)
);

CREATE TABLE `webhook_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `app_id` varchar(255) DEFAULT NULL,
  `event` varchar(255) DEFAULT NULL,
  `channel` varchar(255) DEFAULT NULL,
  `socket_id` varchar(255) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `payload` text DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `app_id` (`app_id`),
  KEY `user_id` (`user_id`)
);

CREATE TABLE `settings` (
  `key` varchar(255) NOT NULL,
  `value` text DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `settings` (`key`, `value`) VALUES ('wsDomain', '') ON DUPLICATE KEY UPDATE `value`=VALUES(`value`);

CREATE TABLE `user_2fa` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `secret` varchar(255) NOT NULL,
  `enabled` tinyint(1) DEFAULT 0,
  `backup_codes` text DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`)
);

CREATE TABLE `ip_whitelist` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `app_id` varchar(255) NOT NULL,
  `ip` varchar(45) NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `app_id` (`app_id`)
);