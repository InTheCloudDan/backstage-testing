/*
 * Copyright 2023 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Strategy as OAuth2Strategy, InternalOAuthError } from 'passport-oauth2';
import { URL } from 'url';

interface LaunchDarklyStrategyRequiredOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    baseURL?: string;
    authorizationURL?: string;
    tokenURL?: string;
    scope?: string;
}

interface LaunchDarklyStrategyOptions {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  baseURL?: string;
  authorizationURL?: string;
  tokenURL?: string;
  scope?: string;
}

interface LaunchDarklyProfile {
    provider: string;
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    json: Object;
}

class LaunchDarklyStrategy extends OAuth2Strategy {
    private _profileURL: string;
    name: string;

    constructor(options: LaunchDarklyStrategyOptions, verify: OAuth2Strategy.VerifyFunction) {
        // @ts-ignore
        // eslint-disable-next-line no-param-reassign
        options = options || {};
        const baseURL = options.baseURL || 'https://app.launchdarkly.com';
        options.authorizationURL = options.authorizationURL || new URL('trust/oauth/authorize', baseURL).toString();
        options.tokenURL = options.tokenURL || new URL('trust/oauth/token', baseURL).toString();
        options.scope = options.scope || 'reader';

        super(options, verify);
        this.name = 'LaunchDarkly';
        this._profileURL = new URL('api/v2/members/me', baseURL).toString();
        // @ts-ignore
        this._oauth2.useAuthorizationHeaderForGET(true);
    }

    userProfile(accessToken: string, done: any): void {
        // @ts-ignore
        // eslint-disable-next-line consistent-return
        this._oauth2.get(this._profileURL, accessToken, (err, body) => {
            if (err) {
		// @ts-ignore
                return done(new InternalOAuthError(`Failed to fetch user profile: ${err.toString()}`));
            }

            let json;
            try {
                json = JSON.parse(body as string);
            } catch (ex) {
                return done(new Error('Failed to parse user profile'));
            }

            const profile: LaunchDarklyProfile = {
                provider: 'launchdarkly',
                id: String(json._id),
                firstName: json.firstName,
                lastName: json.lastName,
                email: json.email,
		json: json,
            };

            done(null, profile);
        });
    }
}

export { LaunchDarklyStrategy };
