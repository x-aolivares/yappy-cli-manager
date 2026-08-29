import { Injectable, inject } from '@angular/core';
import { Api } from '../../api-gen/api';
import { listEnvironments } from '../../api-gen/functions';
import { EnvironmentsResponse } from '../../api-gen/models';

@Injectable({ providedIn: 'root' })
export class EnvironmentService {
  private readonly api = inject(Api);

  list(): Promise<EnvironmentsResponse> {
    return this.api.invoke(listEnvironments, {});
  }
}