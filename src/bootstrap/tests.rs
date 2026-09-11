use super::*;

#[test]
fn test_extract_yaml_from_response() {
    let input = "```yaml\nname: test\nservices: {}\n```";
    let output = extract_yaml_from_response(input);
    assert_eq!(output, "name: test\nservices: {}");
}

#[test]
fn test_extract_yaml_no_fences() {
    let input = "name: test\nservices: {}";
    let output = extract_yaml_from_response(input);
    assert_eq!(output, "name: test\nservices: {}");
}

#[test]
fn test_extract_yaml_from_fence_with_surrounding_text() {
    let input = "Here is the config:\n```yaml\nname: test\nservices: {}\n```\nDone.";
    let output = extract_yaml_from_response(input);
    assert_eq!(output, "name: test\nservices: {}");
}

#[test]
fn test_runtime_scripts_exclude_build_only_packages() {
    assert!(runtime_script_name("dev"));
    assert!(runtime_script_name("start:dev"));
    assert!(runtime_script_name("port-forward:ehealth"));
    assert!(!runtime_script_name("build"));
    assert!(!runtime_script_name("typecheck:watch"));
}

#[test]
fn test_env_redaction_preserves_port_evidence() {
    let input = "PORT=4000\nPASSWORD=hunter2\nKEYCLOAK_PASSWORD: visible-secret\nGOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey-material\\n-----END PRIVATE KEY-----'\nDATABASE_URL=postgres://user:pass@localhost:5432/db";
    let output = redact_env_content(input);
    assert!(output.contains("PORT=4000"));
    assert!(output.contains("PASSWORD=<redacted>"));
    assert!(output.contains("KEYCLOAK_PASSWORD:<redacted>"));
    assert!(output.contains("GOOGLE_PRIVATE_KEY:<redacted>"));
    assert!(output.contains("postgres://<redacted>@localhost:5432/db"));
    assert!(!output.contains("hunter2"));
    assert!(!output.contains("visible-secret"));
    assert!(!output.contains("key-material"));
    assert!(!output.contains("user:pass"));
}

#[test]
fn test_env_redaction_removes_multiline_private_key() {
    let input = "PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nsecret-body\n-----END PRIVATE KEY-----\nPORT=4000";
    let output = redact_env_content(input);
    assert_eq!(output, "PRIVATE_KEY=<redacted>\nPORT=4000");
}

#[test]
fn test_env_excerpt_keeps_only_runtime_network_evidence() {
    let input = "PORT=4000\nAPI_URL=http://localhost:4001\nRELATIVE_URL=/graphql\nREMOTE_URL=https://example.com\nPASSWORD=secret\nFEATURE_FLAG=true";
    let output = focused_env_excerpt(input);
    assert!(output.contains("PORT=4000"));
    assert!(output.contains("API_URL=http://localhost:4001"));
    assert!(output.contains("RELATIVE_URL=/graphql"));
    assert!(!output.contains("REMOTE_URL"));
    assert!(!output.contains("PASSWORD"));
    assert!(!output.contains("FEATURE_FLAG"));
}

#[test]
fn test_source_excerpt_keeps_port_and_readiness_context() {
    let input = "import x from 'x';\nconst unrelated = true;\nconst port = process.env.PORT || 4000;\nawait app.listen(port);\nlogger.info(`Listening on ${port}`);\nconst tail = true;";
    let output = focused_source_excerpt(input);
    assert!(output.contains("process.env.PORT"));
    assert!(output.contains("app.listen"));
    assert!(output.contains("Listening on"));
}

#[test]
fn test_source_excerpt_does_not_treat_import_as_port_evidence() {
    let input = "import { something } from 'somewhere';\nconst unrelated = true;";
    let output = focused_source_excerpt(input);
    assert_eq!(output, input);
}

#[test]
fn test_helm_excerpt_compacts_release_evidence() {
    let input = r#"environments:
  develop: {}
releases:
  - name: api
    namespace: platform
    chart: charts/app
    needs:
      - kafka/config
      - postgres
    values:
      - irrelevant.yaml
  - name: web
    namespace: platform
    chart: charts/app
    needs:
      - api
"#;
    let output = focused_helm_excerpt(input);
    assert!(output.contains("- name: api"));
    assert!(output.contains("namespace: platform"));
    assert!(output.contains("- kafka/config"));
    assert!(output.contains("- name: web"));
    assert!(!output.contains("irrelevant.yaml"));
}

#[test]
fn test_validate_config_empty_name() {
    let yaml = "name: \"\"\nservices: {}";
    let result = validate_config_yaml(yaml);
    assert!(result.is_ok());
    let (_, issues) = result.unwrap();
    assert!(issues.iter().any(|i| i.severity == IssueSeverity::Error));
}

#[test]
fn test_validate_config_rejects_dependency_cycle() {
    let yaml = r#"
name: test
services:
  api:
    command: api
    dependsOn: [worker]
  worker:
    command: worker
    dependsOn: [api]
"#;
    let (_, issues) = validate_config_yaml(yaml).unwrap();
    assert!(issues.iter().any(|issue| {
        issue.severity == IssueSeverity::Error
            && issue.message.contains("Circular service dependency")
    }));
}

#[test]
fn test_validate_config_rejects_duplicate_fixed_ports() {
    let yaml = r#"
name: test
services: {}
portforwards:
  - name: db
    namespace: dev
    pod: db
    localPort: 15432
    remotePort: 5432
  - name: replica
    namespace: dev
    pod: replica
    localPort: 15432
    remotePort: 5432
"#;
    let (_, issues) = validate_config_yaml(yaml).unwrap();
    assert!(issues.iter().any(|issue| {
        issue.severity == IssueSeverity::Error && issue.message.contains("Fixed local port")
    }));
}

#[test]
fn test_validate_config_warns_for_repeated_service_defaults() {
    let yaml = r#"
name: test
services:
  web-a:
    command: web-a
    port: 3000
  web-b:
    command: web-b
    port: 3000
"#;
    let (_, issues) = validate_config_yaml(yaml).unwrap();
    assert!(issues.iter().any(|issue| {
        issue.severity == IssueSeverity::Warning
            && issue.message.contains("Configured service port 3000")
    }));
    assert!(!issues.iter().any(|issue| {
        issue.severity == IssueSeverity::Error && issue.message.contains("port 3000")
    }));
}
