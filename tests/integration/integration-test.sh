#!/usr/bin/env bash

COMPONENT_COUNT=13
USERS_COUNT=16
GROUP_COUNT=8
RESOURCE_COUNT=1
SYSTEM_COUNT=3
DOMAIN_COUNT=2

# Test the number of components using kubctl get -o json and jq
exit_status=0

count=$(kubectl get components.servicemodel.ext.grafana.com -o json | jq '[.items[] | select(.kind == "Component")] | length')
if [ $count -ne $COMPONENT_COUNT ]; then
    echo "Expected $COMPONENT_COUNT components, found $count"
    exit_status=1
fi

count=$(kubectl get users.servicemodel.ext.grafana.com -o json | jq '[.items[] | select(.kind == "User")] | length')
if [ $count -ne $USERS_COUNT ]; then
    echo "Expected $USERS_COUNT users, found $count"
    exit_status=1
fi

count=$(kubectl get resources.servicemodel.ext.grafana.com -o json | jq '[.items[] | select(.kind == "Resource")] | length')
if [ $count -ne $RESOURCE_COUNT ]; then
    echo "Expected $RESOURCE_COUNT resources, found $count"
    exit_status=1
fi

count=$(kubectl get groups.servicemodel.ext.grafana.com -o json | jq '[.items[] | select(.kind == "Group")] | length')
if [ $count -ne $GROUP_COUNT ]; then
    echo "Expected $GROUP_COUNT groups, found $count"
    exit_status=1
fi

count=$(kubectl get systems.servicemodel.ext.grafana.com -o json | jq '[.items[] | select(.kind == "System")] | length')
if [ $count -ne $SYSTEM_COUNT ]; then
    echo "Expected $SYSTEM_COUNT systems, found $count"
    exit_status=1
fi

count=$(kubectl get domains.servicemodel.ext.grafana.com -o json | jq '[.items[] | select(.kind == "Domain")] | length')
if [ $count -ne $DOMAIN_COUNT ]; then
    echo "Expected $DOMAIN_COUNT domains, found $count"
    exit_status=1
fi

exit $exit_status


echo "Integration test passed"


