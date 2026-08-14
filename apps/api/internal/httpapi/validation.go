package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Viper3-yu/fabric/apps/api/internal/apperror"
)

var (
	sha256Pattern       = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)
	phonePattern        = regexp.MustCompile(`^[+\d][\d\s-]+$`)
	trackingPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]*$`)
	deliveryCodePattern = regexp.MustCompile(`^\d{6}$`)
)

type flexibleFloat float64

func (n *flexibleFloat) UnmarshalJSON(content []byte) error {
	var number json.Number
	if len(content) > 0 && content[0] == '"' {
		var text string
		if err := json.Unmarshal(content, &text); err != nil {
			return err
		}
		number = json.Number(text)
	} else {
		number = json.Number(string(content))
	}
	value, err := number.Float64()
	if err != nil || math.IsInf(value, 0) || math.IsNaN(value) {
		return fmt.Errorf("expected a finite number")
	}
	*n = flexibleFloat(value)
	return nil
}

type flexibleInt int

func (n *flexibleInt) UnmarshalJSON(content []byte) error {
	var value flexibleFloat
	if err := value.UnmarshalJSON(content); err != nil {
		return err
	}
	if math.Trunc(float64(value)) != float64(value) {
		return fmt.Errorf("expected an integer")
	}
	*n = flexibleInt(value)
	return nil
}

type loginBody struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type addressBody struct {
	Province     string `json:"province"`
	City         string `json:"city"`
	District     string `json:"district"`
	Detail       string `json:"detail"`
	ContactName  string `json:"contactName"`
	ContactPhone string `json:"contactPhone"`
}

type goodsBody struct {
	Name        string        `json:"name"`
	Category    string        `json:"category"`
	Quantity    flexibleInt   `json:"quantity"`
	WeightKG    flexibleFloat `json:"weightKg"`
	Description string        `json:"description"`
}

type temperatureRangeBody struct {
	Min  flexibleFloat `json:"min"`
	Max  flexibleFloat `json:"max"`
	Unit string        `json:"unit"`
}

type createShipmentBody struct {
	Origin               addressBody           `json:"origin"`
	Destination          addressBody           `json:"destination"`
	Goods                goodsBody             `json:"goods"`
	ExpectedDeliveryDate string                `json:"expectedDeliveryDate"`
	TemperatureRange     *temperatureRangeBody `json:"temperatureRange"`
	DocumentHash         string                `json:"documentHash"`
}

type actionBody struct {
	Location     string         `json:"location"`
	Description  string         `json:"description"`
	Temperature  *flexibleFloat `json:"temperature"`
	EvidenceHash string         `json:"evidenceHash"`
	Reason       string         `json:"reason"`
	DeliveryCode string         `json:"deliveryCode"`
}

type verifyBody struct {
	TrackingNumber string `json:"trackingNumber"`
	EvidenceHash   string `json:"evidenceHash"`
}

func decodeJSON(request *http.Request, target any) error {
	reader := http.MaxBytesReader(nil, request.Body, 256*1024)
	defer reader.Close()
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		var maxBytes *http.MaxBytesError
		if ok := errorAs(err, &maxBytes); ok {
			return apperror.New(413, "PAYLOAD_TOO_LARGE", "Request body exceeds the 256 KB limit")
		}
		return apperror.New(400, "INVALID_JSON", "Request body is not valid JSON")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return apperror.New(400, "INVALID_JSON", "Request body is not valid JSON")
	}
	return nil
}

func validateLogin(body *loginBody) error {
	body.Username = strings.TrimSpace(body.Username)
	if err := length(body.Username, 1, 40, "username"); err != nil {
		return validationError(err)
	}
	if len(body.Password) < 1 || len(body.Password) > 128 {
		return validationError(fmt.Errorf("password must contain 1 to 128 characters"))
	}
	return nil
}

func validateCreate(body *createShipmentBody) error {
	if err := validateAddress(&body.Origin, "origin"); err != nil {
		return validationError(err)
	}
	if err := validateAddress(&body.Destination, "destination"); err != nil {
		return validationError(err)
	}
	body.Goods.Name = strings.TrimSpace(body.Goods.Name)
	body.Goods.Category = strings.TrimSpace(body.Goods.Category)
	body.Goods.Description = strings.TrimSpace(body.Goods.Description)
	if err := length(body.Goods.Name, 1, 80, "goods.name"); err != nil {
		return validationError(err)
	}
	if err := length(body.Goods.Category, 1, 40, "goods.category"); err != nil {
		return validationError(err)
	}
	if body.Goods.Quantity < 1 || body.Goods.Quantity > 100000 {
		return validationError(fmt.Errorf("goods.quantity must be from 1 to 100000"))
	}
	if body.Goods.WeightKG <= 0 || body.Goods.WeightKG > 1000000 {
		return validationError(fmt.Errorf("goods.weightKg must be greater than 0 and at most 1000000"))
	}
	if body.Goods.Description != "" {
		if err := length(body.Goods.Description, 1, 300, "goods.description"); err != nil {
			return validationError(err)
		}
	}
	body.ExpectedDeliveryDate = strings.TrimSpace(body.ExpectedDeliveryDate)
	if _, err := time.Parse("2006-01-02", body.ExpectedDeliveryDate); err != nil {
		return validationError(fmt.Errorf("expectedDeliveryDate must use a valid YYYY-MM-DD date"))
	}
	if body.TemperatureRange != nil {
		if body.TemperatureRange.Unit == "" {
			body.TemperatureRange.Unit = "C"
		}
		if body.TemperatureRange.Unit != "C" ||
			body.TemperatureRange.Min < -100 || body.TemperatureRange.Max > 100 ||
			body.TemperatureRange.Min >= body.TemperatureRange.Max {
			return validationError(fmt.Errorf("temperatureRange must use C and min must be lower than max within -100 to 100"))
		}
	}
	body.DocumentHash = strings.ToLower(strings.TrimSpace(body.DocumentHash))
	if body.DocumentHash != "" && !sha256Pattern.MatchString(body.DocumentHash) {
		return validationError(fmt.Errorf("documentHash must be a 64-character SHA-256 hex digest"))
	}
	return nil
}

func validateAction(action string, body *actionBody) error {
	body.Location = strings.TrimSpace(body.Location)
	body.Description = strings.TrimSpace(body.Description)
	body.EvidenceHash = strings.ToLower(strings.TrimSpace(body.EvidenceHash))
	body.Reason = strings.TrimSpace(body.Reason)
	body.DeliveryCode = strings.TrimSpace(body.DeliveryCode)
	requiredLocation := action == "pickup" || action == "checkpoint" ||
		action == "exception" || action == "resolve" || action == "deliver"
	requiredDescription := action == "checkpoint" || action == "exception" || action == "resolve"
	requiredEvidence := action == "deliver"
	if requiredLocation {
		if err := length(body.Location, 1, 120, "location"); err != nil {
			return validationError(err)
		}
	} else if body.Location != "" {
		if err := length(body.Location, 1, 120, "location"); err != nil {
			return validationError(err)
		}
	}
	if requiredDescription {
		if err := length(body.Description, 1, 300, "description"); err != nil {
			return validationError(err)
		}
	} else if body.Description != "" {
		if err := length(body.Description, 1, 300, "description"); err != nil {
			return validationError(err)
		}
	}
	if action == "checkpoint" && body.Temperature != nil &&
		(*body.Temperature < -100 || *body.Temperature > 100) {
		return validationError(fmt.Errorf("temperature must be from -100 to 100"))
	}
	if body.EvidenceHash != "" && !sha256Pattern.MatchString(body.EvidenceHash) {
		return validationError(fmt.Errorf("evidenceHash must be a 64-character SHA-256 hex digest"))
	}
	if requiredEvidence && body.EvidenceHash == "" {
		return validationError(fmt.Errorf("evidenceHash is required"))
	}
	if action == "confirm" && !deliveryCodePattern.MatchString(body.DeliveryCode) {
		return validationError(fmt.Errorf("deliveryCode must contain 6 digits"))
	}
	if action == "cancel" && body.Reason != "" {
		if err := length(body.Reason, 1, 300, "reason"); err != nil {
			return validationError(err)
		}
	}
	return nil
}

func validateVerify(body *verifyBody) error {
	body.TrackingNumber = strings.TrimSpace(body.TrackingNumber)
	body.EvidenceHash = strings.ToLower(strings.TrimSpace(body.EvidenceHash))
	if err := length(body.TrackingNumber, 4, 100, "trackingNumber"); err != nil {
		return validationError(err)
	}
	if !validTrackingNumber(body.TrackingNumber) {
		return invalidTrackingError()
	}
	if body.EvidenceHash != "" && !sha256Pattern.MatchString(body.EvidenceHash) {
		return validationError(fmt.Errorf("evidenceHash must be a 64-character SHA-256 hex digest"))
	}
	return nil
}

// validTrackingNumber mirrors the chaincode identifier rule so an invalid
// number is rejected as a 400 here instead of surfacing as a gateway 502.
func validTrackingNumber(value string) bool {
	return trackingPattern.MatchString(value)
}

func invalidTrackingError() error {
	return validationError(fmt.Errorf(
		"trackingNumber may only contain letters, numbers, dot, underscore, colon, or hyphen",
	))
}

func validateAddress(address *addressBody, field string) error {
	address.Province = strings.TrimSpace(address.Province)
	address.City = strings.TrimSpace(address.City)
	address.District = strings.TrimSpace(address.District)
	address.Detail = strings.TrimSpace(address.Detail)
	address.ContactName = strings.TrimSpace(address.ContactName)
	address.ContactPhone = strings.TrimSpace(address.ContactPhone)
	for _, item := range []struct {
		value string
		min   int
		max   int
		name  string
	}{
		{address.Province, 1, 30, field + ".province"},
		{address.City, 1, 30, field + ".city"},
		{address.Detail, 2, 120, field + ".detail"},
		{address.ContactName, 1, 40, field + ".contactName"},
		{address.ContactPhone, 7, 30, field + ".contactPhone"},
	} {
		if err := length(item.value, item.min, item.max, item.name); err != nil {
			return err
		}
	}
	if address.District != "" {
		if err := length(address.District, 1, 50, field+".district"); err != nil {
			return err
		}
	}
	if !phonePattern.MatchString(address.ContactPhone) {
		return fmt.Errorf("%s.contactPhone is invalid", field)
	}
	return nil
}

func length(value string, minimum, maximum int, field string) error {
	count := len([]rune(value))
	if count < minimum || count > maximum {
		return fmt.Errorf("%s must contain %d to %d characters", field, minimum, maximum)
	}
	return nil
}

func validationError(err error) error {
	return apperror.WithDetails(400, "VALIDATION_ERROR", "Request validation failed", map[string]string{
		"formErrors": err.Error(),
	})
}

func parseLimit(value string, fallback, minimum, maximum int, field string) (int, error) {
	if value == "" {
		return fallback, nil
	}
	number, err := strconv.Atoi(value)
	if err != nil || number < minimum || number > maximum {
		return 0, validationError(fmt.Errorf("%s must be from %d to %d", field, minimum, maximum))
	}
	return number, nil
}

func errorAs(err error, target any) bool {
	switch value := target.(type) {
	case **http.MaxBytesError:
		var candidate *http.MaxBytesError
		if ok := asMaxBytes(err, &candidate); ok {
			*value = candidate
			return true
		}
	}
	return false
}

func asMaxBytes(err error, target **http.MaxBytesError) bool {
	for err != nil {
		if candidate, ok := err.(*http.MaxBytesError); ok {
			*target = candidate
			return true
		}
		type unwrapper interface{ Unwrap() error }
		value, ok := err.(unwrapper)
		if !ok {
			return false
		}
		err = value.Unwrap()
	}
	return false
}

func encodeBody(value any) []byte {
	content, _ := json.Marshal(value)
	return bytes.TrimSpace(content)
}
