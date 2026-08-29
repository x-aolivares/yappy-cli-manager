import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

const CARDS: { link: string; title: string; body: string }[] = [
  {
    link: '/db-diff',
    title: 'Diff de Base de Datos',
    body: 'Compara una tabla o un stored procedure entre dos ambientes. Si difieren te genera el script de actualización: CREATE para crear, ALTER TABLE con el diff de columnas e índices, o CREATE OR REPLACE PROCEDURE.',
  },
  {
    link: '/params-diff',
    title: 'Diff de Parámetros / Secretos',
    body: 'Compara un parámetro de SSM Parameter Store o un secreto de Secrets Manager entre dos ambientes. Si el valor es JSON, actualiza solo las claves que cambiaron, sin sobreescribir el parámetro completo.',
  },
  {
    link: '/params-read',
    title: 'Leer Parámetros / Secretos',
    body: 'Pegás una lista de parámetros como JSON — [{ "key": "/path", "is_secret": false }] — y ves los valores de una. Si marcás is_secret: true los lee de Secrets Manager; el resto, de SSM.',
  },
  {
    link: '/params-create',
    title: 'Crear en varias regiones',
    body: 'Un valor, varias regiones: parámetro SSM o, marcando la opción, también secreto en Secrets Manager con el parámetro duplicado como SecureString. Genera los comandos por región o ejecútalos con tu confirmación.',
  },
  {
    link: '/sessions',
    title: 'Sesiones de parámetros',
    body: 'Pegás tu lista de parámetros desde la hoja de cálculo, elegís región de origen y destino, y vas ítem por ítem: cada uno se abre en Parámetros y el progreso queda guardado localmente para revisarlo después.',
  },
  {
    link: '/params-edit',
    title: 'Editar un parámetro',
    body: 'Elegís el ambiente y ves el valor actual de un parámetro (con decodificación de SecureString), lo editás y lo guardás con tu confirmación.',
  },
  {
    link: '/compile',
    title: 'Compilar / Ejecutar SQL',
    body: 'Elegís un ambiente y pegás el código SQL/DDL (tabla o stored procedure) para ejecutarlo directo contra esa base: ALTER / CREATE TABLE, CREATE OR REPLACE PROCEDURE, etc. Se compila y te muestra el resultado de cada sentencia.',
  },
];

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  template: `
    <h1>Sincronización entre regiones AWS</h1>
    <p class="muted">
      Se comparan la <strong>región de origen</strong> (izquierda, contiene los cambios nuevos) y la
      <strong>región destino</strong> (derecha, se actualiza). Las regiones son los ambientes
      definidos en <code>config/env.*</code> de yappy-cli-manager.
    </p>
    <div class="cards">
      @for (card of cards; track card.link) {
        <a class="card" [routerLink]="card.link">
          <h2>{{ card.title }}</h2>
          <p>{{ card.body }}</p>
        </a>
      }
    </div>
  `,
})
export class HomePage {
  readonly cards = CARDS;
}