USE lianyun;
INSERT INTO users (username,password_hash,display_name,role,fabric_org) VALUES
('admin','$2a$10$demo','平台管理员','ADMIN','Org1MSP'),
('shipper','$2a$10$demo','杭州货主','SHIPPER','Org1MSP'),
('carrier','$2a$10$demo','承运运营员','CARRIER','Org2MSP'),
('auditor','$2a$10$demo','审计员','AUDITOR','Org1MSP')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),role=VALUES(role),fabric_org=VALUES(fabric_org);

INSERT INTO route_plans (shipment_id,sequence_no,from_hub_code,to_hub_code,planned_departure,planned_arrival,actual_departure,actual_arrival,carrier_org,status) VALUES
('YT20260001',1,'HZ-WH-01','HZ-HUB-01','2026-09-01 08:00:00','2026-09-01 10:00:00','2026-09-01 08:22:00','2026-09-01 10:05:00','Org2MSP','NORMAL'),
('YT20260001',2,'HZ-HUB-01','WH-HUB-01','2026-09-01 10:30:00','2026-09-01 17:00:00','2026-09-01 10:34:00','2026-09-01 18:20:00','Org2MSP','EXCEPTION'),
('YT20260001',3,'WH-HUB-01','BJ-HUB-01','2026-09-01 17:30:00','2026-09-02 08:00:00','2026-09-02 00:52:00',NULL,'Org2MSP','IN_TRANSIT'),
('YT20260001',4,'BJ-HUB-01','BJ-DLV-01','2026-09-02 08:30:00','2026-09-02 11:00:00',NULL,NULL,'Org2MSP','PLANNED')
ON DUPLICATE KEY UPDATE planned_departure=VALUES(planned_departure),planned_arrival=VALUES(planned_arrival),actual_departure=VALUES(actual_departure),actual_arrival=VALUES(actual_arrival),carrier_org=VALUES(carrier_org),status=VALUES(status);

DELETE FROM telemetry_points WHERE shipment_id='YT20260001';
INSERT INTO telemetry_points (shipment_id,recorded_at,longitude,latitude,speed_kmh) VALUES
('YT20260001','2026-09-01 08:20:00',120.155070,30.274084,0),
('YT20260001','2026-09-01 10:05:00',120.174000,30.278000,42),
('YT20260001','2026-09-01 15:00:00',114.600000,30.700000,76),
('YT20260001','2026-09-01 18:20:00',114.305500,30.593100,0),
('YT20260001','2026-09-02 01:20:00',114.800000,31.000000,80);

DELETE FROM temperature_readings WHERE shipment_id='YT20260001';
INSERT INTO temperature_readings (shipment_id,recorded_at,temperature_c,humidity,device_code) VALUES
('YT20260001','2026-09-01 10:30:00',8.1,52,'T-009'),
('YT20260001','2026-09-01 13:00:00',8.7,54,'T-009'),
('YT20260001','2026-09-01 16:00:00',10.8,61,'T-009'),
('YT20260001','2026-09-01 18:20:00',9.2,58,'T-009'),
('YT20260001','2026-09-02 01:20:00',8.6,54,'T-009');
