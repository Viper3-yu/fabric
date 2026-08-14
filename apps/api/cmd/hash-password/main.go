// Command hash-password prints a bcrypt hash for a password so deployment
// operators can populate DEMO_PASSWORD_HASH_<USER> without storing plaintext.
//
// Usage:
//
//	go run ./apps/api/cmd/hash-password 'a long password'
//
// The password can also be read from stdin when no argument is given. Note
// that stdin input echoes on Windows terminals; prefer the argument form on a
// trusted machine or generate the hash on a secure host.
package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	password := strings.TrimSpace(strings.Join(os.Args[1:], " "))
	if password == "" {
		fmt.Fprint(os.Stderr, "Password: ")
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil {
			log.Fatalf("read password: %v", err)
		}
		password = strings.TrimSpace(line)
	}
	if password == "" {
		log.Fatal("an empty password cannot be hashed")
	}
	if len(password) > 72 {
		log.Fatal("bcrypt accepts at most 72 bytes per password")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("hash password: %v", err)
	}
	fmt.Println(string(hash))
}
