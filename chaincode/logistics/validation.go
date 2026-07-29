package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
)

var (
	hashPattern       = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)
	identifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]*$`)
)

func parseCreateShipment(inputJSON string) (createShipmentInput, error) {
	var input createShipmentInput
	if err := parsePayload(inputJSON, "CreateShipment input", &input); err != nil {
		return input, err
	}
	var err error
	if input.ID, err = identifier(input.ID, "id"); err != nil {
		return input, err
	}
	if input.TrackingNumber, err = identifier(input.TrackingNumber, "trackingNumber"); err != nil {
		return input, err
	}
	for _, field := range []struct {
		value string
		name  string
		max   int
	}{
		{input.ShipperID, "shipperId", 128},
		{input.ShipperName, "shipperName", 128},
		{input.RecipientMasked, "recipientMasked", 256},
	} {
		if err := requireString(field.value, field.name, field.max); err != nil {
			return input, err
		}
	}
	if !strings.Contains(input.RecipientMasked, "*") {
		return input, fmt.Errorf(`Invalid recipientMasked: value must be masked and contain "*"`)
	}
	if err := validateAddress(input.Origin, "origin"); err != nil {
		return input, err
	}
	if err := validateAddress(input.Destination, "destination"); err != nil {
		return input, err
	}
	if err := validateGoods(input.Goods); err != nil {
		return input, err
	}
	if err := validDate(input.ExpectedDeliveryDate, "expectedDeliveryDate"); err != nil {
		return input, err
	}
	if input.TemperatureRange != nil {
		if input.TemperatureRange.Min > input.TemperatureRange.Max {
			return input, fmt.Errorf("Invalid temperatureRange: min must be less than or equal to max")
		}
		if input.TemperatureRange.Min < -273.15 || input.TemperatureRange.Max > 10000 {
			return input, fmt.Errorf("Invalid temperatureRange: values are outside the supported range")
		}
		if input.TemperatureRange.Unit != "C" {
			return input, fmt.Errorf(`Invalid temperatureRange.unit: only "C" is supported`)
		}
	}
	if err := requiredHash(input.DeliveryCodeHash, "deliveryCodeHash"); err != nil {
		return input, err
	}
	input.DeliveryCodeHash = strings.ToLower(input.DeliveryCodeHash)
	if err := optionalHash(input.DocumentHash, "documentHash"); err != nil {
		return input, err
	}
	input.DocumentHash = strings.ToLower(input.DocumentHash)
	if input.Location != "" {
		if err := requireString(input.Location, "location", 256); err != nil {
			return input, err
		}
	}
	if input.Description != "" {
		if err := requireString(input.Description, "description", 500); err != nil {
			return input, err
		}
	}
	return input, nil
}

func parseAction(inputJSON, label string) (actionInput, error) {
	var input actionInput
	if err := parsePayload(inputJSON, label, &input); err != nil {
		return input, err
	}
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.ActorName = strings.TrimSpace(input.ActorName)
	input.CarrierID = strings.TrimSpace(input.CarrierID)
	input.CarrierName = strings.TrimSpace(input.CarrierName)
	input.Location = strings.TrimSpace(input.Location)
	input.Description = strings.TrimSpace(input.Description)
	input.EvidenceHash = strings.TrimSpace(input.EvidenceHash)
	return input, nil
}

func parsePayload(inputJSON, label string, target any) error {
	if strings.TrimSpace(inputJSON) == "" {
		return fmt.Errorf("Invalid %s: expected a non-empty JSON object string", label)
	}
	if len([]byte(inputJSON)) > maxPayloadBytes {
		return fmt.Errorf("Invalid %s: payload exceeds %d bytes", label, maxPayloadBytes)
	}
	decoder := json.NewDecoder(bytes.NewBufferString(inputJSON))
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("Invalid %s: malformed JSON", label)
	}
	if decoder.More() {
		return fmt.Errorf("Invalid %s: malformed JSON", label)
	}
	return nil
}

func validateActor(input actionInput) error {
	if err := requireString(input.ActorID, "actorId", 128); err != nil {
		return err
	}
	return requireString(input.ActorName, "actorName", 128)
}

func validateAddress(value model.Address, field string) error {
	for _, item := range []struct {
		value string
		name  string
		max   int
	}{
		{value.Province, field + ".province", 128},
		{value.City, field + ".city", 128},
		{value.Detail, field + ".detail", 256},
		{value.ContactName, field + ".contactName", 128},
		{value.ContactPhoneMasked, field + ".contactPhoneMasked", 64},
	} {
		if err := requireString(item.value, item.name, item.max); err != nil {
			return err
		}
	}
	if value.District != "" {
		if err := requireString(value.District, field+".district", 128); err != nil {
			return err
		}
	}
	if !strings.Contains(value.ContactPhoneMasked, "*") {
		return fmt.Errorf(`Invalid %s.contactPhoneMasked: value must be masked and contain "*"`, field)
	}
	return nil
}

func validateGoods(goods model.GoodsInfo) error {
	if err := requireString(goods.Name, "goods.name", 128); err != nil {
		return err
	}
	if err := requireString(goods.Category, "goods.category", 128); err != nil {
		return err
	}
	if goods.Quantity < 1 || goods.Quantity > 1_000_000 {
		return fmt.Errorf("Invalid goods.quantity: expected an integer from 1 to 1000000")
	}
	if goods.WeightKG < 0.001 || goods.WeightKG > 1_000_000 {
		return fmt.Errorf("Invalid goods.weightKg: expected a value from 0.001 to 1000000")
	}
	if goods.Description != "" {
		return requireString(goods.Description, "goods.description", 500)
	}
	return nil
}

func requireString(value, field string, maxLength int) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fmt.Errorf("Invalid %s: expected a non-empty string", field)
	}
	if len([]rune(trimmed)) > maxLength {
		return fmt.Errorf("Invalid %s: must not exceed %d characters", field, maxLength)
	}
	return nil
}

func identifier(value, field string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) > 128 || !identifierPattern.MatchString(value) {
		return "", fmt.Errorf(
			"Invalid %s: use letters, numbers, dot, underscore, colon, or hyphen without spaces",
			field,
		)
	}
	return value, nil
}

func requiredHash(value, field string) error {
	if !hashPattern.MatchString(strings.TrimSpace(value)) {
		return fmt.Errorf(
			"Invalid %s: expected a 64-character SHA-256 hexadecimal digest",
			field,
		)
	}
	return nil
}

func optionalHash(value, field string) error {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return requiredHash(value, field)
}

func validDate(value, field string) error {
	value = strings.TrimSpace(value)
	if _, err := time.Parse("2006-01-02", value); err == nil {
		return nil
	}
	if _, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return nil
	}
	return fmt.Errorf("Invalid %s: expected an ISO date or date-time string", field)
}

func addressLocation(address model.Address) string {
	parts := []string{address.Province, address.City}
	if address.District != "" {
		parts = append(parts, address.District)
	}
	return strings.Join(parts, " / ")
}
