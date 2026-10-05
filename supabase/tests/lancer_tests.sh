#!/usr/bin/env bash
# Joue toute la suite de tests SQL sur un Postgres jetable (Docker). Depuis le dossier mad-app :
#   bash supabase/tests/lancer_tests.sh
set -u
C=madtest_suite
docker rm -f $C >/dev/null 2>&1
docker run -d --name $C -e POSTGRES_PASSWORD=pw postgres:16-alpine >/dev/null
for i in $(seq 1 40); do docker exec $C pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done; sleep 5
run() { docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
run < supabase/tests/stub_auth.sql || exit 1
for f in supabase/migrations/*.sql supabase/seed.sql; do run < "$f" || { echo "ÉCHEC migration $f"; exit 1; }; done
total=0; echec=0
for t in regles cloture import besoins; do
  r=$(docker exec -i $C psql -U postgres -q -A -F ' ' < supabase/tests/test_$t.sql 2>&1 | grep -A1 '^pass' | tail -1)
  echo "test_$t : $r"; set -- $r; total=$((total+$1)); echec=$((echec+$2))
done
run < supabase/seed_referentiels.sql
for t in referentiels catalogue comptes; do
  out=$(docker exec -i $C psql -U postgres -q -A -F ' | ' < supabase/tests/test_$t.sql 2>&1)
  r=$(echo "$out" | grep -A1 '^pass' | tail -1 | tr -d '|'); echo "test_$t : $r"; set -- $r; total=$((total+$1)); echec=$((echec+$2))
  echo "$out" | grep -E '^[0-9]+ \| FAIL' 
done
echo "TOTAL : $total réussis, $echec échec(s)"
docker rm -f $C >/dev/null 2>&1
