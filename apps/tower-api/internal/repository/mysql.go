package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"tower-api/internal/domain"
)

type MySQL struct{ db *sql.DB }

func NewMySQL(dsn string) (*MySQL, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetConnMaxLifetime(3 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("MySQL 连接失败: %w", err)
	}
	return &MySQL{db: db}, nil
}
func (m *MySQL) Close() error { return m.db.Close() }

func (m *MySQL) LoadHubs() ([]domain.Hub, error) {
	rows, err := m.db.Query(`SELECT hub_code,hub_name,city,longitude,latitude,hub_type FROM hubs ORDER BY hub_code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Hub
	for rows.Next() {
		var h domain.Hub
		if err = rows.Scan(&h.Code, &h.Name, &h.City, &h.Longitude, &h.Latitude, &h.Type); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func (m *MySQL) LoadSegments(shipmentID string, hubs map[string]domain.Hub) ([]domain.RouteSegment, error) {
	rows, err := m.db.Query(`SELECT id,sequence_no,from_hub_code,to_hub_code,planned_departure,planned_arrival,actual_departure,actual_arrival,carrier_org,status,polyline_json FROM route_plans WHERE shipment_id=? ORDER BY sequence_no`, shipmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.RouteSegment
	for rows.Next() {
		var id int64
		var from, to string
		var plannedDeparture, plannedArrival time.Time
		var actualDeparture, actualArrival sql.NullTime
		var raw []byte
		var s domain.RouteSegment
		if err = rows.Scan(&id, &s.Sequence, &from, &to, &plannedDeparture, &plannedArrival, &actualDeparture, &actualArrival, &s.CarrierOrg, &s.Status, &raw); err != nil {
			return nil, err
		}
		s.ID = fmt.Sprintf("SEG-%02d", s.Sequence)
		s.FromHub = hubs[from]
		s.ToHub = hubs[to]
		s.PlannedDeparture = plannedDeparture.UTC().Format(time.RFC3339)
		s.PlannedArrival = plannedArrival.UTC().Format(time.RFC3339)
		if actualDeparture.Valid {
			s.ActualDeparture = actualDeparture.Time.UTC().Format(time.RFC3339)
		}
		if actualArrival.Valid {
			s.ActualArrival = actualArrival.Time.UTC().Format(time.RFC3339)
		}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &s.Polyline)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (m *MySQL) LoadGPS(shipmentID string) ([]domain.MapPoint, error) {
	rows, err := m.db.Query(`SELECT longitude,latitude,recorded_at,COALESCE(speed_kmh,0) FROM telemetry_points WHERE shipment_id=? ORDER BY recorded_at`, shipmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.MapPoint
	for rows.Next() {
		var p domain.MapPoint
		var at time.Time
		if err = rows.Scan(&p.Longitude, &p.Latitude, &at, &p.Speed); err != nil {
			return nil, err
		}
		p.At = at.UTC().Format(time.RFC3339)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (m *MySQL) LoadTemperature(shipmentID string) ([]domain.TemperatureReading, error) {
	rows, err := m.db.Query(`SELECT recorded_at,temperature_c,COALESCE(humidity,0) FROM temperature_readings WHERE shipment_id=? ORDER BY recorded_at`, shipmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.TemperatureReading
	for rows.Next() {
		var p domain.TemperatureReading
		var at time.Time
		if err = rows.Scan(&at, &p.Value, &p.Humidity); err != nil {
			return nil, err
		}
		p.At = at.UTC().Format(time.RFC3339)
		out = append(out, p)
	}
	return out, rows.Err()
}
