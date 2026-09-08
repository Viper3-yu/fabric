CREATE DATABASE IF NOT EXISTS lianyun DEFAULT CHARACTER SET utf8mb4;
-- '%' allows connections from the host into the containerized MySQL; dev only.
CREATE USER IF NOT EXISTS 'lianyun_app'@'%' IDENTIFIED BY 'lianyun_dev';
GRANT SELECT, INSERT, UPDATE, DELETE ON lianyun.* TO 'lianyun_app'@'%';
USE lianyun;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  role ENUM('ADMIN','SHIPPER','CARRIER','AUDITOR','RECEIVER') NOT NULL,
  fabric_org VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hubs (
  hub_code VARCHAR(32) PRIMARY KEY,
  hub_name VARCHAR(128) NOT NULL,
  city VARCHAR(64) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  latitude DECIMAL(10,6) NOT NULL,
  hub_type ENUM('WAREHOUSE','HUB','DELIVERY') NOT NULL
);

CREATE TABLE IF NOT EXISTS route_plans (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  shipment_id VARCHAR(64) NOT NULL,
  sequence_no INT NOT NULL,
  from_hub_code VARCHAR(32) NOT NULL,
  to_hub_code VARCHAR(32) NOT NULL,
  planned_departure DATETIME NOT NULL,
  planned_arrival DATETIME NOT NULL,
  actual_departure DATETIME NULL,
  actual_arrival DATETIME NULL,
  carrier_org VARCHAR(32) NOT NULL,
  status ENUM('NORMAL','EXCEPTION','IN_TRANSIT','PLANNED') NOT NULL DEFAULT 'PLANNED',
  polyline_json JSON NULL,
  UNIQUE KEY uk_route_sequence (shipment_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS telemetry_points (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  shipment_id VARCHAR(64) NOT NULL,
  recorded_at DATETIME NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  latitude DECIMAL(10,6) NOT NULL,
  speed_kmh DECIMAL(6,2) NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'GPS_SIM',
  INDEX idx_telemetry_shipment_time (shipment_id, recorded_at)
);

CREATE TABLE IF NOT EXISTS temperature_readings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  shipment_id VARCHAR(64) NOT NULL,
  recorded_at DATETIME NOT NULL,
  temperature_c DECIMAL(5,2) NOT NULL,
  humidity DECIMAL(5,2) NULL,
  device_code VARCHAR(64) NOT NULL,
  INDEX idx_temperature_shipment_time (shipment_id, recorded_at)
);

CREATE TABLE IF NOT EXISTS evidence_files (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  shipment_id VARCHAR(64) NOT NULL,
  evidence_type ENUM('HANDOVER','EXCEPTION','DELIVERY','TEMPERATURE') NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  uploaded_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO hubs VALUES
('HZ-WH-01','杭州滨江仓','杭州',120.155070,30.274084,'WAREHOUSE'),
('HZ-HUB-01','杭州分拨中心','杭州',120.174000,30.278000,'HUB'),
('WH-HUB-01','武汉中转中心','武汉',114.305500,30.593100,'HUB'),
('BJ-HUB-01','北京分拨中心','北京',116.407400,39.904200,'HUB'),
('BJ-DLV-01','北京朝阳末端网点','北京',116.486400,39.921900,'DELIVERY')
ON DUPLICATE KEY UPDATE hub_name=VALUES(hub_name),city=VALUES(city),longitude=VALUES(longitude),latitude=VALUES(latitude),hub_type=VALUES(hub_type);
