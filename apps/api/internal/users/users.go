package users

import "github.com/Viper3-yu/fabric/chaincode/logistics/model"

type Account struct {
	User     model.User
	Password string
	// PasswordHash is a bcrypt hash of the account password. When set it
	// takes precedence over Password and is the only accepted production
	// credential form; the plaintext Password remains the built-in course
	// demo fallback for development and tests.
	PasswordHash string
}

var Accounts = []Account{
	{
		User: model.User{
			ID: "shipper-demo", Username: "shipper", DisplayName: "星河商贸",
			Role: "shipper", MSPID: "Org1MSP",
		},
		Password: "shipper123",
	},
	{
		User: model.User{
			ID: "carrier-demo", Username: "carrier", DisplayName: "迅达物流",
			Role: "carrier", MSPID: "Org2MSP",
		},
		Password: "carrier123",
	},
	{
		User: model.User{
			ID: "receiver-demo", Username: "receiver", DisplayName: "演示收货人",
			Role: "receiver", MSPID: "Org1MSP",
		},
		Password: "receiver123",
	},
	{
		User: model.User{
			ID: "auditor-demo", Username: "auditor", DisplayName: "课程审计员",
			Role: "auditor", MSPID: "ReadOnly",
		},
		Password: "auditor123",
	},
}

var (
	ByUsername = make(map[string]Account, len(Accounts))
	ByID       = make(map[string]model.User, len(Accounts))
)

func init() {
	for _, account := range Accounts {
		ByUsername[account.User.Username] = account
		ByID[account.User.ID] = account.User
	}
}

// Configure applies environment-provided credential overrides to the built-in
// demo accounts. Passwords from the DEMO_PASSWORD_<USER> variables replace the
// source-code defaults; DEMO_PASSWORD_HASH_<USER> variables set bcrypt hashes
// that then take precedence over plaintext passwords at authentication time.
func Configure(passwords map[string]string, hashes map[string]string) {
	for username, password := range passwords {
		account, ok := ByUsername[username]
		if !ok {
			continue
		}
		account.Password = password
		account.PasswordHash = ""
		ByUsername[username] = account
	}
	for username, hash := range hashes {
		account, ok := ByUsername[username]
		if !ok {
			continue
		}
		account.PasswordHash = hash
		ByUsername[username] = account
	}
}
