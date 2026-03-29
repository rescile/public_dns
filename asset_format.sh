#!/usr/bin/env bash

# Basis-Verzeichnis
BASE_DIR="./data/assets"

# Wir loopen durch jedes Unterverzeichnis (die eigentlichen Zonen)
for ZONE_DIR in "$BASE_DIR"/*/; do
    [[ -d "$ZONE_DIR" ]] || continue

    AUTH_FILE="${ZONE_DIR}auth.csv"

    # 1. Den Zonennamen aus der auth.csv extrahieren
    if [[ -f "$AUTH_FILE" ]]; then
        # Wir suchen die Zeile, die mit 'auth' oder 'auth_zone' beginnt und nehmen das 2. Feld
        ZONE_NAME=$(awk -F',' '/^auth_zone,|^auth,/ {print $2}' "$AUTH_FILE")
    else
        echo "Warnung: Keine auth.csv in $ZONE_DIR gefunden. Überspringe Ordner."
        continue
    fi

    echo "Verarbeite Zone: $ZONE_NAME in $ZONE_DIR"

    for FILE in "${ZONE_DIR}"*.csv; do
        [[ -e "$FILE" ]] || continue
        TEMP_FILE="${FILE}.tmp"
        FILENAME=$(basename "$FILE")

        case "$FILENAME" in
            a.csv)
                echo "  -> A-Records"
                # Erst sed-Transformation, dann mit awk die Spalte 'zone' anhängen
                sed -e 's/header-record:a/type/g' -e 's/fqdn/name/g' -e 's/record:a/a/g' "$FILE" | \
                awk -v zone="$ZONE_NAME" -F',' 'BEGIN {OFS=","} {if (NR==1) print $0,"zone"; else print $0,zone}' > "$TEMP_FILE"
                ;;
            cname.csv)
                echo "  -> CNAME-Records"
                sed -e 's/header-record:cname/type/g' -e 's/fqdn/name/g' -e 's/record:cname/cname/g' "$FILE" | \
                awk -v zone="$ZONE_NAME" -F',' 'BEGIN {OFS=","} {if (NR==1) print $0,"zone"; else print $0,zone}' > "$TEMP_FILE"
                ;;
            mx.csv)
                echo "  -> MX-Records"
                # Hier hattest du bereits fqdn -> zone gemappt, ich füge es konsistent hinzu
                sed -e 's/header-record:mx/type/g' -e 's/fqdn/zone/g' -e 's/mx/name/g' -e 's/record:mx/mx/g' "$FILE" > "$TEMP_FILE"
                ;;
            auth.csv)
                echo "  -> Auth-Zone"
                sed -e 's/header-auth_zone/type/g' -e 's/fqdn/name/g' -e 's/auth_zone/auth/g' "$FILE" > "$TEMP_FILE"
                ;;
            *)
                continue
                ;;
        esac

        if [ -f "$TEMP_FILE" ]; then
            mv "$TEMP_FILE" "$FILE"
        fi
    done
done

echo "Transformation inklusive Zone-Mapping abgeschlossen."
