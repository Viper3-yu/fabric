package apperror

import "fmt"

type Error struct {
	Status  int
	Code    string
	Message string
	Details any
}

func (e *Error) Error() string {
	return e.Message
}

func New(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

func WithDetails(status int, code, message string, details any) *Error {
	return &Error{Status: status, Code: code, Message: message, Details: details}
}

func Wrap(status int, code, message string, cause error) *Error {
	return WithDetails(status, code, message, fmt.Sprint(cause))
}
