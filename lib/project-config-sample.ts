// To provide GitHub credentials, please either go to AWS CodeBuild Console to connect
// or call ImportSourceCredentials to persist your personal access token. Example:
// aws codebuild import-source-credentials --server-type GITHUB --auth-type PERSONAL_ACCESS_TOKEN --token <token_value>

export const project = {
    test: true,
    owner: 'OWNER_NAME',    // Same as Github owner
    repository: 'PROJECT_NAME',    // Same as Github repository name
    environments: ['staging', 'production'],
    dns: {
        domain: 'EXAMPLE.COM.BR'
    }
    
}