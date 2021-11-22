import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { OpenIdConfiguration } from '../config/openid-configuration';
import { CallbackContext } from '../flows/callback-context';
import { FlowsDataService } from '../flows/flows-data.service';
import { FlowsService } from '../flows/flows.service';
import { IntervalService } from './interval.service';

@Injectable({ providedIn: 'root' })
export class ImplicitFlowCallbackService {
  constructor(
    private flowsService: FlowsService,
    private router: Router,
    private flowsDataService: FlowsDataService,
    private intervalService: IntervalService
  ) {}

  authenticatedImplicitFlowCallback(
    config: OpenIdConfiguration,
    allConfigs: OpenIdConfiguration[],
    hash?: string
  ): Observable<CallbackContext> {
    const isRenewProcess = this.flowsDataService.isSilentRenewRunning(config);
    const { triggerAuthorizationResultEvent, postLoginRoute, unauthorizedRoute, configId } = config;

    return this.flowsService.processImplicitFlowCallback(config, allConfigs, hash).pipe(
      tap((callbackContext) => {
        if (!triggerAuthorizationResultEvent && !callbackContext.isRenewProcess) {
          this.router.navigateByUrl(postLoginRoute);
        }
      }),
      catchError((error) => {
        this.flowsDataService.resetSilentRenewRunning(configId);
        this.intervalService.stopPeriodicTokenCheck();
        if (!triggerAuthorizationResultEvent && !isRenewProcess) {
          this.router.navigateByUrl(unauthorizedRoute);
        }

        return throwError(() => new Error(error));
      })
    );
  }
}
