package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type OrgConfig struct {
	MSPID         string
	CertPath      string
	KeyPath       string
	PeerEndpoint  string
	PeerHostAlias string
	TLSCertPath   string
}

type FabricConfig struct {
	ConnectionProfilePath string
	ChannelName           string
	ChaincodeName         string
	PeerEndpoint          string
	PeerHostAlias         string
	TLSCertPath           string
	Org1                  OrgConfig
	Org2                  OrgConfig
}

type Config struct {
	Environment    string
	Host           string
	Port           int
	LedgerMode     string
	JWTSecret      string
	JWTExpiresIn   time.Duration
	CORSOrigins    []string
	DemoLedgerPath string
	DemoAutoSeed   bool
	Fabric         FabricConfig
}

func Load() (Config, error) {
	if envFile := strings.TrimSpace(os.Getenv("ENV_FILE")); envFile != "" {
		if err := loadEnvFile(envFile); err != nil {
			return Config{}, fmt.Errorf("load ENV_FILE: %w", err)
		}
	}

	environment := env("NODE_ENV", "development")
	mode := env("LEDGER_MODE", "demo")
	if environment != "development" && environment != "test" && environment != "production" {
		return Config{}, fmt.Errorf("NODE_ENV must be development, test, or production")
	}
	if mode != "demo" && mode != "fabric" {
		return Config{}, fmt.Errorf("LEDGER_MODE must be demo or fabric")
	}

	port, err := strconv.Atoi(env("PORT", "3001"))
	if err != nil || port < 1 || port > 65535 {
		return Config{}, fmt.Errorf("PORT must be from 1 to 65535")
	}
	expires, err := time.ParseDuration(env("JWT_EXPIRES_IN", "8h"))
	if err != nil || expires <= 0 {
		return Config{}, fmt.Errorf("JWT_EXPIRES_IN must be a positive Go duration such as 8h")
	}
	autoSeed, err := strconv.ParseBool(env("DEMO_AUTO_SEED", "true"))
	if err != nil {
		return Config{}, fmt.Errorf("DEMO_AUTO_SEED must be true or false")
	}

	jwtSecret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if (mode == "fabric" || environment == "production") && len(jwtSecret) < 16 {
		return Config{}, fmt.Errorf("JWT_SECRET with at least 16 characters is required in Fabric mode and production")
	}
	if jwtSecret == "" {
		jwtSecret = "demo-only-jixin-secret-change-me"
	}

	demoPath := strings.TrimSpace(os.Getenv("DEMO_LEDGER_PATH"))
	if demoPath == "" {
		demoPath = defaultDemoPath()
	}

	return Config{
		Environment:    environment,
		Host:           env("HOST", "127.0.0.1"),
		Port:           port,
		LedgerMode:     mode,
		JWTSecret:      jwtSecret,
		JWTExpiresIn:   expires,
		CORSOrigins:    splitList(env("CORS_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173")),
		DemoLedgerPath: demoPath,
		DemoAutoSeed:   autoSeed,
		Fabric: FabricConfig{
			ConnectionProfilePath: strings.TrimSpace(os.Getenv("FABRIC_CONNECTION_PROFILE_PATH")),
			ChannelName:           env("FABRIC_CHANNEL_NAME", "logisticschannel"),
			ChaincodeName:         env("FABRIC_CHAINCODE_NAME", "logistics"),
			PeerEndpoint:          strings.TrimSpace(os.Getenv("FABRIC_PEER_ENDPOINT")),
			PeerHostAlias:         strings.TrimSpace(os.Getenv("FABRIC_PEER_HOST_ALIAS")),
			TLSCertPath:           strings.TrimSpace(os.Getenv("FABRIC_TLS_CERT_PATH")),
			Org1: OrgConfig{
				MSPID:         env("FABRIC_ORG1_MSP_ID", "Org1MSP"),
				CertPath:      strings.TrimSpace(os.Getenv("FABRIC_ORG1_CERT_PATH")),
				KeyPath:       strings.TrimSpace(os.Getenv("FABRIC_ORG1_KEY_PATH")),
				PeerEndpoint:  strings.TrimSpace(os.Getenv("FABRIC_ORG1_PEER_ENDPOINT")),
				PeerHostAlias: strings.TrimSpace(os.Getenv("FABRIC_ORG1_PEER_HOST_ALIAS")),
				TLSCertPath:   strings.TrimSpace(os.Getenv("FABRIC_ORG1_TLS_CERT_PATH")),
			},
			Org2: OrgConfig{
				MSPID:         env("FABRIC_ORG2_MSP_ID", "Org2MSP"),
				CertPath:      strings.TrimSpace(os.Getenv("FABRIC_ORG2_CERT_PATH")),
				KeyPath:       strings.TrimSpace(os.Getenv("FABRIC_ORG2_KEY_PATH")),
				PeerEndpoint:  strings.TrimSpace(os.Getenv("FABRIC_ORG2_PEER_ENDPOINT")),
				PeerHostAlias: strings.TrimSpace(os.Getenv("FABRIC_ORG2_PEER_HOST_ALIAS")),
				TLSCertPath:   strings.TrimSpace(os.Getenv("FABRIC_ORG2_TLS_CERT_PATH")),
			},
		},
	}, nil
}

func defaultDemoPath() string {
	if details, err := os.Stat(filepath.Join("apps", "api")); err == nil && details.IsDir() {
		return filepath.Join("apps", "api", "data", "demo-ledger.json")
	}
	return filepath.Join("data", "demo-ledger.json")
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func splitList(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func loadEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "\uFEFF"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			return fmt.Errorf("invalid environment line %q", line)
		}
		key = strings.TrimSpace(key)
		if key == "" {
			return errors.New("environment key cannot be empty")
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	return scanner.Err()
}
