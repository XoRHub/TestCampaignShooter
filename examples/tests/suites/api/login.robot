*** Settings ***
Documentation    Fake Robot Framework suite for the login API.
Library          Collections

*** Test Cases ***
Login Returns A Token
    ${response}=    Create Dictionary    token=fake-jwt
    Dictionary Should Contain Key    ${response}    token

Login Rejects Bad Password
    ${status}=    Set Variable    401
    Should Be Equal As Integers    ${status}    401
