import { Component, input, model } from '@angular/core';
import { EnvironmentInfo } from '../api-gen/models';
import { EnvSelectComponent } from './env-select';

@Component({
  selector: 'app-region-controls',
  imports: [EnvSelectComponent],
  template: `
    <div class="form-grid">
      <div>
        <label for="env-b">Región de Origen</label>
        <app-env-select [environments]="environments()" [(value)]="envB" />
      </div>
      <div>
        <label for="env-a">Región Destino</label>
        <app-env-select [environments]="environments()" [(value)]="envA" />
      </div>
      @if (withService()) {
        <div>
          <label for="service">Servicio</label>
          <select
            id="service"
            [value]="service() || ''"
            (change)="service.set($any($event.target).value)">
            <option value="" disabled [selected]="!service()">Seleccione un servicio</option>
            <option value="ssm">SSM Parameter Store</option>
            <option value="secretsmanager">Secrets Manager</option>
          </select>
        </div>
      }
      @if (withName()) {
        <div>
          <label for="name">Nombre del parámetro / secreto</label>
          <input
            id="name"
            type="text"
            [value]="nameValue()"
            (input)="nameValue.set($any($event.target).value)"
            placeholder="p. ej. /yappy/dev/rate"
            spellcheck="false"
          />
        </div>
      }
    </div>
  `,
})
export class RegionControlsComponent {
  environments = input<EnvironmentInfo[] | null>(null);
  withService = input(true);
  withName = input(false);

  envB = model('');
  envA = model('');
  service = model<string>('');
  nameValue = model('');
}