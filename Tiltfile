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