import { Component, computed, input } from '@angular/core';
import { statusLabel } from '../core/format';

@Component({
  selector: 'app-badge',
  template: `<span class="badge {{ status() }}">{{ display() }}</span>`,
})
export class StatusBadge {
  status = input.required<string>();
  label = input<string | null>(null);

  readonly display = computed(() => this.label() ?? statusLabel(this.status()));
}