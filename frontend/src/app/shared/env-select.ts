import { Component, input, model } from '@angular/core';
import { EnvironmentInfo } from '../api-gen/models';

@Component({
  selector: 'app-env-select',
  template: `
    <select
      [disabled]="!environments()"
      [value]="value()"
      (change)="value.set($any($event.target).value)">
      @if (!value()) {
        <option value="" disabled>Seleccioná el ambiente…</option>
      }
      @for (e of environments() ?? []; track e.env) {
        <option [value]="e.env">
          {{ e.env }} — {{ e.region || '' }} ({{ e.profile || '' }})
          @if (e.load_error) {
            (error: {{ e.load_error }})
          }
        </option>
      }
    </select>
  `,
})
export class EnvSelectComponent {
  environments = input<EnvironmentInfo[] | null>(null);
  value = model<string>('');
}