const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

export const fcfa = (n: number | null | undefined) =>
  n == null ? '–' : nf.format(Math.round(n)).replace(/[  ]/g, ' ') + ' FCFA'

export const nombre = (n: number | null | undefined) =>
  n == null ? '–' : nf.format(Math.round(n)).replace(/[  ]/g, ' ')

export const pct = (x: number | null | undefined) =>
  x == null || Number.isNaN(x) ? '–' : (x * 100).toFixed(1).replace('.', ',') + ' %'

export const date = (t: string | null | undefined) =>
  t ? new Date(t).toLocaleDateString('fr-FR') : '–'

export const somme = <T,>(a: T[], f: (x: T) => number | null | undefined) =>
  a.reduce((s, x) => s + (f(x) || 0), 0)
