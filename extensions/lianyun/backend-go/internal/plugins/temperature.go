package plugins

import (
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
)

type TemperaturePlugin struct {
	Points     []TemperaturePoint
	MinAllowed float64
	MaxAllowed float64
}

func (p *TemperaturePlugin) Name() string { return "temperature" }
func (p *TemperaturePlugin) Ingest(shipmentID string, payload []byte) error {
	rows, err := csv.NewReader(strings.NewReader(string(payload))).ReadAll()
	if err != nil {
		return err
	}
	if len(rows) < 2 {
		return fmt.Errorf("CSV 没有数据")
	}
	for _, row := range rows[1:] {
		if len(row) < 4 {
			return fmt.Errorf("CSV 列不足")
		}
		v, err := strconv.ParseFloat(row[1], 64)
		if err != nil {
			return err
		}
		h, _ := strconv.ParseFloat(row[2], 64)
		p.Points = append(p.Points, TemperaturePoint{ShipmentID: shipmentID, RecordedAt: row[0], TemperatureC: v, Humidity: h, DeviceCode: row[3]})
	}
	return nil
}
func (p *TemperaturePlugin) Summarize(shipmentID string) (TelemetrySummary, error) {
	var rawBuilder strings.Builder
	abnormal := 0
	for _, x := range p.Points {
		if x.ShipmentID != shipmentID {
			continue
		}
		rawBuilder.WriteString(fmt.Sprintf("%s,%.2f,%.2f,%s\n", x.RecordedAt, x.TemperatureC, x.Humidity, x.DeviceCode))
		if x.TemperatureC < p.MinAllowed || x.TemperatureC > p.MaxAllowed {
			abnormal++
		}
	}
	sum := sha256.Sum256([]byte(rawBuilder.String()))
	return TelemetrySummary{ShipmentID: shipmentID, Plugin: p.Name(), SHA256: hex.EncodeToString(sum[:]), AbnormalCount: abnormal, Message: "温湿度原始数据链下保存，摘要与异常数量上链"}, nil
}
