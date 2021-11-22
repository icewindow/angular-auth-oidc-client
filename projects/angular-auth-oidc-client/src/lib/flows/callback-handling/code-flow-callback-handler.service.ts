import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of, throwError, timer } from 'rxjs';
import { catchError, mergeMap, retryWhen, switchMap } from 'rxjs/operators';
import { DataService } from '../../api/data.service';
import { OpenIdConfiguration } from '../../config/openid-configuration';
import { LoggerService } from '../../logging/logger.service';
import { StoragePersistenceService } from '../../storage/storage-persistence.service';
import { UrlService } from '../../utils/url/url.service';
import { TokenValidationService } from '../../validation/token-validation.service';
import { CallbackContext } from '../callback-context';
import { FlowsDataService } from '../flows-data.service';

@Injectable()
export class CodeFlowCallbackHandlerService {
  constructor(
    private readonly urlService: UrlService,
    private readonly loggerService: LoggerService,
    private readonly tokenValidationService: TokenValidationService,
    private readonly flowsDataService: FlowsDataService,
    private readonly storagePersistenceService: StoragePersistenceService,
    private readonly dataService: DataService
  ) {}

  // STEP 1 Code Flow
  codeFlowCallback(urlToCheck: string, config: OpenIdConfiguration): Observable<CallbackContext> {
    const code = this.urlService.getUrlParameter(urlToCheck, 'code');
    const state = this.urlService.getUrlParameter(urlToCheck, 'state');
    const sessionState = this.urlService.getUrlParameter(urlToCheck, 'session_state');

    if (!state) {
      this.loggerService.logDebug(config, 'no state in url');

      return throwError(() => new Error('no state in url'));
    }

    if (!code) {
      this.loggerService.logDebug(config, 'no code in url');

      return throwError(() => new Error('no code in url'));
    }

    this.loggerService.logDebug(config, 'running validation for callback', urlToCheck);

    const initialCallbackContext = {
      code,
      refreshToken: null,
      state,
      sessionState,
      authResult: null,
      isRenewProcess: false,
      jwtKeys: null,
      validationResult: null,
      existingIdToken: null,
    };

    return of(initialCallbackContext);
  }

  // STEP 2 Code Flow //  Code Flow Silent Renew starts here
  codeFlowCodeRequest(callbackContext: CallbackContext, config: OpenIdConfiguration): Observable<CallbackContext> {
    const { configId } = config;
    const authStateControl = this.flowsDataService.getAuthStateControl(configId);
    const isStateCorrect = this.tokenValidationService.validateStateFromHashCallback(callbackContext.state, authStateControl, configId);

    if (!isStateCorrect) {
      return throwError(() => new Error('codeFlowCodeRequest incorrect state'));
    }

    const authWellknownEndpoints = this.storagePersistenceService.read('authWellKnownEndPoints', configId);
    const tokenEndpoint = authWellknownEndpoints?.tokenEndpoint;
    if (!tokenEndpoint) {
      return throwError(() => new Error('Token Endpoint not defined'));
    }

    let headers: HttpHeaders = new HttpHeaders();
    headers = headers.set('Content-Type', 'application/x-www-form-urlencoded');

    const bodyForCodeFlow = this.urlService.createBodyForCodeFlowCodeRequest(callbackContext.code, config, config?.customParamsCodeRequest);

    return this.dataService.post(tokenEndpoint, bodyForCodeFlow, configId, headers).pipe(
      switchMap((response) => {
        let authResult: any = new Object();
        authResult = response;
        authResult.state = callbackContext.state;
        authResult.session_state = callbackContext.sessionState;

        callbackContext.authResult = authResult;

        return of(callbackContext);
      }),
      retryWhen((error) => this.handleRefreshRetry(error, config)),
      catchError((error) => {
        const { authority } = config;
        const errorMessage = `OidcService code request ${authority}`;
        this.loggerService.logError(config, errorMessage, error);

        return throwError(() => new Error(errorMessage));
      })
    );
  }

  private handleRefreshRetry(errors: Observable<any>, config: OpenIdConfiguration): Observable<any> {
    return errors.pipe(
      mergeMap((error) => {
        // retry token refresh if there is no internet connection
        if (error && error instanceof HttpErrorResponse && error.error instanceof ProgressEvent && error.error.type === 'error') {
          const { authority, refreshTokenRetryInSeconds } = config;
          const errorMessage = `OidcService code request ${authority} - no internet connection`;
          this.loggerService.logWarning(config, errorMessage, error);

          return timer(refreshTokenRetryInSeconds * 1000);
        }

        return throwError(() => new Error(error));
      })
    );
  }
}
