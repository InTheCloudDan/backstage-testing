/*
 * Copyright 2020 The Backstage Authors
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

import passport, { Profile as PassportProfile } from 'passport';
import { commonByEmailResolver } from '../resolvers';
import { LaunchDarklyStrategy } from './strategy';
import {
  encodeState,
  OAuthAdapter,
  OAuthEnvironmentHandler,
  OAuthHandlers,
  OAuthProviderOptions,
  OAuthRefreshRequest,
  OAuthResponse,
  OAuthResult,
  OAuthStartRequest,
} from '../../lib/oauth';
import {
  executeFetchUserProfileStrategy,
  executeFrameHandlerStrategy,
  executeRedirectStrategy,
  executeRefreshTokenStrategy,
  makeProfileInfo,
  PassportDoneCallback,
} from '../../lib/passport';
import { createAuthProviderIntegration } from '../createAuthProviderIntegration';
import {
  AuthHandler,
  OAuthStartResponse,
  SignInResolver,
  AuthResolverContext,
} from '../types';
import { googleAuthenticator } from '../../../../auth-backend-module-google-provider/src';
import { createOAuthProviderFactory } from '../../../../auth-node/src';
import { adaptLegacyOAuthHandler, adaptLegacyOAuthSignInResolver } from '../../lib/legacy';

type PrivateInfo = {
  refreshToken: string;
};

type Options = OAuthProviderOptions & {
  signInResolver?: SignInResolver<OAuthResult>;
  authHandler: AuthHandler<LaunchDarklyOAuthResult>;
  resolverContext: AuthResolverContext;
};

/** @public */
export type LaunchDarklyOAuthResult = {
  fullProfile: PassportProfile;
  params: {
    id_token?: string;
    scope: string;
    expires_in: number;
  };
  accessToken: string;
  refreshToken?: string;
};

/** @public */
export type LaunchDarklyPassportProfile = PassportProfile & {
  id?: string;
  firstName?: string;
  username?: string;
  avatarUrl?: string;
  _json?: {
    links?: {
      avatar?: {
        href?: string;
      };
    };
  };
};

export class LaunchDarklyAuthProvider implements OAuthHandlers {
  private readonly _strategy: LaunchDarklyStrategy;
  private readonly signInResolver?: SignInResolver<OAuthResult>;
  private readonly authHandler: AuthHandler<OAuthResult>;
  private readonly resolverContext: AuthResolverContext;

  constructor(options: Options) {
    this.signInResolver = options.signInResolver;
    this.authHandler = options.authHandler;
    this.resolverContext = options.resolverContext;
    this._strategy = new LaunchDarklyStrategy(
      {
        clientID: options.clientId,
        clientSecret: options.clientSecret,
        callbackURL: options.callbackUrl,
        passReqToCallback: false,
      },
      (
        accessToken: any,
        refreshToken: any,
        params: any,
        fullProfile: passport.Profile,
        done: PassportDoneCallback<OAuthResult, PrivateInfo>,
      ) => {
        done(
          undefined,
          {
            fullProfile,
            params,
            accessToken,
            refreshToken,
          },
          {
            refreshToken,
          },
        );
      },
    );
  }

  async start(req: OAuthStartRequest): Promise<OAuthStartResponse> {
    return await executeRedirectStrategy(req, this._strategy, {
      accessType: 'offline',
      prompt: 'consent',
      scope: req.scope,
      state: encodeState(req.state),
    });
  }

  async handler(req: express.Request) {
    const { result, privateInfo } = await executeFrameHandlerStrategy<
      OAuthResult,
      PrivateInfo
    >(req, this._strategy);

    return {
      response: await this.handleResult(result),
      refreshToken: privateInfo.refreshToken,
    };
  }

  async refresh(req: OAuthRefreshRequest) {
    const { accessToken, refreshToken, params } =
      await executeRefreshTokenStrategy(
        this._strategy,
        req.refreshToken,
        req.scope,
      );
    const fullProfile = await executeFetchUserProfileStrategy(
      this._strategy,
      accessToken,
    );
    return {
      response: await this.handleResult({
        fullProfile,
        params,
        accessToken,
      }),
      refreshToken,
    };
  }

  private async handleResult(result: LaunchDarklyOAuthResult) {
    const { profile } = await this.authHandler(result, this.resolverContext);

    const response: OAuthResponse = {
      providerInfo: {
        // Not sure about this one.
        idToken: result.params.id_token,
        accessToken: result.accessToken,
        scope: result.params.scope,
        expiresInSeconds: result.params.expires_in,
      },
      profile,
    };

    if (this.signInResolver) {
      response.backstageIdentity = await this.signInResolver(
        {
          result,
          profile,
        },
        this.resolverContext,
      );
    }

    return response;
  }
}

/**
 * Auth provider integration for LaunchDarkly auth
 *
 * @public
 */
export const launchdarkly = createAuthProviderIntegration({
  create(options?: {
    /**
     * The profile transformation function used to verify and convert the auth response
     * into the profile that will be presented to the user.
     */
    authHandler?: AuthHandler<OAuthResult>;

    /**
     * Configure sign-in for this provider, without it the provider can not be used to sign users in.
     */
    signIn?: {
      /**
       * Maps an auth result to a Backstage identity for the user.
       */
      resolver: SignInResolver<OAuthResult>;
    };
  }) {
    return createOAuthProviderFactory({
      authenticator: googleAuthenticator,
      profileTransform: adaptLegacyOAuthHandler(options?.authHandler),
      signInResolver: adaptLegacyOAuthSignInResolver(options?.signIn?.resolver),
    });
    // return ({ providerId, globalConfig, config, resolverContext }) =>
    //   OAuthEnvironmentHandler.mapConfig(config, envConfig => {
    //     const clientId = envConfig.getString('clientId');
    //     const clientSecret = envConfig.getString('clientSecret');
    //     const customCallbackUrl = envConfig.getOptionalString('callbackUrl');
    //     const callbackUrl =
    //       customCallbackUrl ||
    //       `${globalConfig.baseUrl}/${providerId}/handler/frame`;

    //     const authHandler: AuthHandler<LaunchDarklyOAuthResult> =
    //       options?.authHandler
    //         ? options.authHandler
    //         : async ({ fullProfile, params }) => ({
    //             profile: makeProfileInfo(fullProfile, params.id_token),
    //           });

    //     const provider = new LaunchDarklyAuthProvider({
    //       clientId,
    //       clientSecret,
    //       callbackUrl,
    //       signInResolver: options?.signIn?.resolver,
    //       authHandler,
    //       resolverContext,
    //     });

    //     return OAuthAdapter.fromConfig(globalConfig, provider, {
    //       providerId,
    //       callbackUrl,
    //     });
    //   });
  },
  resolvers: {
    /**
     * Looks up the user by matching their email to the entity email.
     */
    emailMatchingUserEntityProfileEmail:
      (): SignInResolver<LaunchDarklyOAuthResult> => commonByEmailResolver,
  },
});
