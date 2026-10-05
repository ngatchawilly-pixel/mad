// Règle de mot de passe appliquée par l'interface (la base ne voit que le haché).
export const MDP_MIN = 10

export function controleMdp(mdp: string): string[] {
  const manques: string[] = []
  if (mdp.length < MDP_MIN) manques.push(`au moins ${MDP_MIN} caractères`)
  if (!/[a-z]/.test(mdp)) manques.push('une minuscule')
  if (!/[A-Z]/.test(mdp)) manques.push('une majuscule')
  if (!/[0-9]/.test(mdp)) manques.push('un chiffre')
  return manques
}
