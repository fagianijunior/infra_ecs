// To provide GitHub credentials, please either go to AWS CodeBuild Console to connect
// or call ImportSourceCredentials to persist your personal access token. Example:
// aws codebuild import-source-credentials --server-type GITHUB --auth-type PERSONAL_ACCESS_TOKEN --token <token_value>

export const project = {
    s3: {
        exist: true
    },
    vpc: {
        subnet: {
            private: false
        }
    },
    test: true,
    owner: 'seudinheiro',    // Same as Github owner
    repository: 'wordpress',    // Same as Github repository name
    environments: [
        'staging',
        'production'
    ],
    dns: {
        domain: 'seudinheiro.com'
    },
    secrets: {
        "key": "value"
    }
}