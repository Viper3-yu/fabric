package config

import (
	"bufio"
	"errors"
	"fmt"
	"log"
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
	Environment  string
	Host         string
	Port         int
	JWTSecret    string
	JWTExpiresIn time.Duration
	CORSOrigins  []string
	// PublicRateLimitPerMinute caps unauthenticated /api/public/ requests per
	// client IP; 0 disables the limiter.
	PublicRateLimitPerMinute int
	// TrustProxyHeaders enables deriving the client IP from the right-most
	// X-Forwarded-For entry. Only set it when a trusted reverse proxy sits in
	// front of the API; otherwise clients spoof the header and bypass limits.
	TrustProxyHeaders bool
	// AccountPasswords maps account usernames to plaintext password overrides
	// (development convenience only). AccountPasswordHashes maps usernames to
	// bcrypt hashes and takes precedence; production deployments must supply
	// hashes for every built-in account.
	AccountPasswords      map[string]string
	AccountPasswordHashes map[string]string
	Fabric                FabricConfig
}

// AccountUsernames lists the built-in role accounts that credentials can be
// configured for via APP_PASSWORD_<USER> / APP_PASSWORD_HASH_<USER>.
var AccountUsernames = []string{"shipper", "carrier", "receiver", "auditor"}

func Load() (Config, error) {
	loadDefaultEnvFile()
	if envFile := strings.TrimSpace(os.Getenv("ENV_FILE")); envFile != "" {
		if err := loadEnvFile(envFile); err != nil {
			return Config{}, fmt.Errorf("load ENV_FILE: %w", err)
		}
	}

	environment := env("NODE_ENV", "development")
	if environment != "development" && environment != "test" && environment != "production" {
		return Config{}, fmt.Errorf("NODE_ENV must be development, test, or production")
	}

	port, err := strconv.Atoi(env("PORT", "3001"))
	if err != nil || port < 1 || port > 65535 {
		return Config{}, fmt.Errorf("PORT must be from 1 to 65535")
	}
	expires, err := time.ParseDuration(env("JWT_EXPIRES_IN", "8h"))
	if err != nil || expires <= 0 {
		return Config{}, fmt.Errorf("JWT_EXPIRES_IN must be a positive Go duration such as 8h")
	}
	publicLimit, err := strconv.Atoi(env("PUBLIC_RATE_LIMIT_PER_MINUTE", "60"))
	if err != nil || publicLimit < 0 || publicLimit > 1_000_000 {
		return Config{}, fmt.Errorf("PUBLIC_RATE_LIMIT_PER_MINUTE must be from 0 (disabled) to 1000000")
	}
	trustProxy, err := strconv.ParseBool(env("TRUST_PROXY", "false"))
	if err != nil {
		return Config{}, fmt.Errorf("TRUST_PROXY must be true or false")
	}

	corsOrigins := splitList(env("CORS_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173"))
	for _, origin := range corsOrigins {
		if origin == "*" {
			return Config{}, fmt.Errorf(
				"CORS_ORIGIN cannot use *: the API sends credentials, so origins must be listed explicitly",
			)
		}
	}

	jwtSecret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if len(jwtSecret) < 16 {
		return Config{}, fmt.Errorf(
			"JWT_SECRET with at least 16 characters is required; generate one with a password manager or `openssl rand -hex 32`",
		)
	}

	passwords, hashes := loadAccountCredentials()
	if environment == "production" {
		for _, username := range AccountUsernames {
			if passwords[username] == "" && hashes[username] == "" {
				return Config{}, fmt.Errorf(
					"APP_PASSWORD_%s or APP_PASSWORD_HASH_%s is required in production",
					strings.ToUpper(username), strings.ToUpper(username),
				)
			}
		}
	} else {
		warnMissingCredentials(passwords, hashes)
	}

	return Config{
		Environment:              environment,
		Host:                     env("HOST", "127.0.0.1"),
		Port:                     port,
		JWTSecret:                jwtSecret,
		JWTExpiresIn:             expires,
		CORSOrigins:              corsOrigins,
		PublicRateLimitPerMinute: publicLimit,
		TrustProxyHeaders:        trustProxy,
		AccountPasswords:         passwords,
		AccountPasswordHashes:    hashes,
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

// loadDefaultEnvFile loads apps/api/.env when ENV_FILE is not set, mirroring
// the dotenv convention so local operators keep credentials out of the shell.
func loadDefaultEnvFile() {
	if strings.TrimSpace(os.Getenv("ENV_FILE")) != "" {
		return
	}
	for _, candidate := range []string{
		filepath.Join("apps", "api", ".env"),
		".env",
	} {
		if details, err := os.Stat(candidate); err == nil && !details.IsDir() {
			_ = loadEnvFile(candidate)
			return
		}
	}
}

func warnMissingCredentials(passwords, hashes map[string]string) {
	missing := make([]string, 0)
	for _, username := range AccountUsernames {
		if passwords[username] == "" && hashes[username] == "" {
			missing = append(missing, username)
		}
	}
	if len(missing) > 0 {
		log.Printf(
			"[jixin-api] no credentials configured for accounts: %s. "+
				"Set APP_PASSWORD_HASH_%s (see apps/api/.env.example) or those accounts cannot sign in.",
			strings.Join(missing, ", "), strings.ToUpper(missing[0]),
		)
	}
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

// loadAccountCredentials collects APP_PASSWORD_<USER> and
// APP_PASSWORD_HASH_<USER> overrides for the four built-in role accounts.
// Hashes (bcrypt) take precedence at authentication time; plaintext overrides
// exist so local development can pin passwords without editing source code.
func loadAccountCredentials() (passwords map[string]string, hashes map[string]string) {
	passwords = make(map[string]string)
	hashes = make(map[string]string)
	for _, username := range AccountUsernames {
		suffix := strings.ToUpper(username)
		if value := strings.TrimSpace(os.Getenv("APP_PASSWORD_" + suffix)); value != "" {
			passwords[username] = value
		}
		if value := strings.TrimSpace(os.Getenv("APP_PASSWORD_HASH_" + suffix)); value != "" {
			hashes[username] = value
		}
	}
	return passwords, hashes
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
