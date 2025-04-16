#!/usr/bin/env bash

COMPONENT_COUNT=13
USERS_COUNT=16
GROUP_COUNT=8
RESOURCE_COUNT=1
SYSTEM_COUNT=3
DOMAIN_COUNT=2

MAX_RETRIES=5
RETRY_DELAY=10

# Function to check resource count with retries
check_resource_count() {
    local resource_type=$1
    local resource_type_singular=$2
    local expected_count=$3
    local exit_status=0
    local attempt=1

    while [ $attempt -le $MAX_RETRIES ]; do
        count=$(kubectl get $resource_type -o json | jq '[.items[] | select(.kind == "'${resource_type_singular}'")] | length')
        if [ $count -ne $expected_count ]; then
            echo "Expected $expected_count ${resource_type_singular}, found $count"
            if [ $attempt -lt $MAX_RETRIES ]; then
                sleep $RETRY_DELAY
            else
                echo "Retry limit reached for $resource_type"
                exit_status=1
            fi
        else
            break
        fi
        attempt=$((attempt + 1))
    done

    return $exit_status
}

# Main test execution
exit_status=0

# Check components
if ! check_resource_count "components.servicemodel.ext.grafana.com" "Component" $COMPONENT_COUNT; then
    exit_status=1
fi

# Check users
if ! check_resource_count "users.servicemodel.ext.grafana.com" "User" $USERS_COUNT; then
    exit_status=1
fi

# Check resources
if ! check_resource_count "resources.servicemodel.ext.grafana.com" "Resource" $RESOURCE_COUNT; then
    exit_status=1
fi

# Check groups
if ! check_resource_count "groups.servicemodel.ext.grafana.com" "Group" $GROUP_COUNT; then
    exit_status=1
fi

# Check systems
if ! check_resource_count "systems.servicemodel.ext.grafana.com" "System" $SYSTEM_COUNT; then
    exit_status=1
fi

# Check domains
if ! check_resource_count "domains.servicemodel.ext.grafana.com" "Domain" $DOMAIN_COUNT; then
    exit_status=1
fi

if [ $exit_status -eq 0 ]; then
    echo "Integration test passed"
else
    echo "Integration test failed"
fi

exit $exit_status


