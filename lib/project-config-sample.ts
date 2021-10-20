// To provide GitHub credentials, please either go to AWS CodeBuild Console to connect
// or call ImportSourceCredentials to persist your personal access token. Example:
// aws codebuild import-source-credentials --server-type GITHUB --auth-type PERSONAL_ACCESS_TOKEN --token <token_value>

export const project = {
    test: false,
    environment: 'production',
    secrets: {
        production: '{"PORT":"3000"}',
        staging: '{"PORT":"3000"}'
    },
    owner: 'fagianijunior',    // Same as Github owner
    repository: 'wordpress',    // Same as Github repository name
    dns: {
        domain: 'fagianijunior.com.br'
    }   
}