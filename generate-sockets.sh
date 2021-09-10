#!/bin/bash

if (( $# != 4 )); then
    echo "Socket Group ID, Name, Project path or Language are not provided"
    exit 2
fi

set -ex

SOCKET_GROUP_ID=$1
SOCKET_GROUP_NAME=$2
GENERATION_FOLDER=$3
LANGUAGE=$4

if [ -f ".env" ]; then
 export $(cat .env | xargs)
fi

# sockets code generation commands
SUDO="sudo"
COMMAND="docker run --name openapi-$SOCKET_GROUP_ID --rm -v ${GENERATION_FOLDER}:/local aitheon/openapi-generator-cli"
FOLDER_PREFIX="/local"
if [[ $LIB_GENERATE_USE_NPM == "true" ]]; then
  echo "Using local java package to generate rest";
  SUDO=""
  COMMAND="java -jar /opt/openapi-generator-cli.jar"
  FOLDER_PREFIX=${GENERATION_FOLDER}
  # cleanup sudo for cloud generation
  SUDO=""
fi

# cleanup language socket group
$SUDO rm -rf ${FOLDER_PREFIX}/$SOCKET_GROUP_NAME/$LANGUAGE

if [ $LANGUAGE == "typescript" ]; then
    $COMMAND generate --skip-validate-spec \
        -i ${FOLDER_PREFIX}/${SOCKET_GROUP_ID}-group-openapi.json \
        -g typescript-angular \
        -o ${FOLDER_PREFIX}/${SOCKET_GROUP_NAME}/$LANGUAGE \
        -D fileNaming=kebab-case \
        -D modelPropertyNaming=original \
        -D prependFormOrBodyParameters=true
fi

if [ $LANGUAGE == "cpp" ]; then
    $COMMAND generate --skip-validate-spec \
        -i ${FOLDER_PREFIX}/${SOCKET_GROUP_ID}-group-openapi.json \
        -g cpp-pistache-server \
        -o ${FOLDER_PREFIX}/${SOCKET_GROUP_NAME}/$LANGUAGE \
        -D modelPackage=aitheon.$SOCKET_GROUP_NAME \
        -D helpersPackage=aitheon.$SOCKET_GROUP_NAME
fi

if [ $LANGUAGE == "python" ]; then
    $COMMAND generate --skip-validate-spec \
        -i ${FOLDER_PREFIX}/${SOCKET_GROUP_ID}-group-openapi.json \
        -g python \
        -o ${FOLDER_PREFIX}/${SOCKET_GROUP_NAME}/$LANGUAGE \
        -D generateSourceCodeOnly=true
fi