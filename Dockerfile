# a Node.js application container
FROM 890606282206.dkr.ecr.eu-west-1.amazonaws.com/alpine-nodegit as builder

# install curl
RUN apk update && apk add nano bash \
    curl openssh \
    && rm -rf /var/cache/apk/*

# add a simple script that can auto-detect the appropriate JAVA_HOME value
# based on whether the JDK or only the JRE is installed
RUN { \
    echo '#!/bin/sh'; \
    echo 'set -e'; \
    echo; \
    echo 'dirname "$(dirname "$(readlink -f "$(which javac || which java)")")"'; \
    } > /usr/local/bin/docker-java-home \
    && chmod +x /usr/local/bin/docker-java-home
ENV JAVA_HOME /usr/lib/jvm/java-1.8-openjdk
ENV PATH $PATH:/usr/lib/jvm/java-1.8-openjdk/jre/bin:/usr/lib/jvm/java-1.8-openjdk/bin

ENV JAVA_VERSION 8u201
ENV LIB_GENERATE_USE_NPM true

RUN set -x \
    && apk add --no-cache \
    openjdk8 \
    && [ "$JAVA_HOME" = "$(docker-java-home)" ]

ADD https://isabel-data.s3-eu-west-1.amazonaws.com/PUBLIC/openapi-generator-cli.jar /opt/openapi-generator-cli.jar


RUN mkdir -p /opt/app /home/coder/workspace


WORKDIR /opt/app

ARG NPM_TOKEN  
COPY .npmrc /opt/app/.npmrc

# copy for faster install
COPY package.json /opt/app/package.json
COPY package-lock.json /opt/app/package-lock.json
RUN npm install

# Copy all code
COPY . /opt/app
RUN npm run server:build

WORKDIR /opt/app

RUN chown -R node:node /opt /home/coder
USER node

RUN rm -f .npmrc

# Expose API port to the outside
EXPOSE 3000

CMD ["npm", "start"]