load('ext://restart_process', 'docker_build_with_restart')

include('tests/integration/definitions/Tiltfile')

docker_build(
    'backstage',
    '.',
    dockerfile='tests/integration/Dockerfile',
    live_update=[
        sync('tests/integration', '/app/backstage'),
    ]
)

k8s_yaml('tests/integration/k8s-dev.yaml')


if config.tilt_subcommand == "ci":
    local_resource(name='run_tests', cmd='tests/integration/integration-test.sh', resource_deps=['backstage'])