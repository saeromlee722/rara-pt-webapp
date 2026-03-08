#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Calorie Calculator Skill
Calculates BMR (Basal Metabolic Rate) and TDEE (Total Daily Energy Expenditure)
based on personal metrics.
"""

import csv
import sys
import os
from pathlib import Path

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')


def calculate_bmr_mifflin(age, gender, weight_kg, height_cm, skeletal_muscle_kg=None):
    """
    Calculate BMR using Mifflin-St Jeor Equation

    For men: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(years) + 5
    For women: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(years) - 161
    """
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age

    if gender.lower() in ['m', 'male', '남', '남자']:
        bmr = base + 5
    else:
        bmr = base - 161

    return round(bmr, 2)


def calculate_tdee(bmr, activity_level):
    """
    Calculate TDEE based on activity level

    Activity levels:
    1.2 = Sedentary (little or no exercise)
    1.375 = Lightly active (exercise 1-3 days/week)
    1.55 = Moderately active (exercise 3-5 days/week)
    1.725 = Very active (exercise 6-7 days/week)
    1.9 = Extra active (hard exercise daily or physical job)
    """
    return round(bmr * activity_level, 2)


def process_csv(input_file):
    """Process input CSV and generate output CSV files"""

    output_dir = Path("output")
    output_dir.mkdir(exist_ok=True)

    results = []

    try:
        with open(input_file, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)

            for row in reader:
                try:
                    # Parse input data
                    name = row.get('고객명', row.get('name', 'Unknown')).strip()
                    age = int(row.get('나이', row.get('age', 0)))
                    gender = row.get('성별', row.get('gender', 'M')).strip()
                    height_cm = float(row.get('키', row.get('height', 0)))
                    weight_kg = float(row.get('몸무게', row.get('weight', 0)))
                    skeletal_muscle = float(row.get('골격근량', row.get('skeletal_muscle', 0)))
                    body_fat = float(row.get('체지방량', row.get('body_fat', 0)))
                    activity_level = float(row.get('활동지수', row.get('activity_level', 1.2)))

                    # Calculate BMR
                    bmr = calculate_bmr_mifflin(age, gender, weight_kg, height_cm, skeletal_muscle)

                    # Calculate TDEE
                    tdee = calculate_tdee(bmr, activity_level)

                    # Store result
                    result = {
                        '고객명': name,
                        '나이': age,
                        '성별': gender,
                        '키_cm': height_cm,
                        '몸무게_kg': weight_kg,
                        '골격근량_kg': skeletal_muscle,
                        '체지방량_kg': body_fat,
                        '활동지수': activity_level,
                        '휴식_칼로리_BMR': bmr,
                        '활동_칼로리_TDEE': tdee,
                        '체지방률_%': round((body_fat / weight_kg * 100), 2) if weight_kg > 0 else 0,
                        '제지방량_kg': round(weight_kg - body_fat, 2)
                    }

                    results.append(result)

                    # Generate individual output file
                    output_file = output_dir / f"{name}.csv"
                    with open(output_file, 'w', encoding='utf-8-sig', newline='') as out_f:
                        writer = csv.DictWriter(out_f, fieldnames=result.keys())
                        writer.writeheader()
                        writer.writerow(result)

                    print(f"[OK] {name}: BMR={bmr} kcal/day, TDEE={tdee} kcal/day -> {output_file}")

                except (ValueError, KeyError) as e:
                    print(f"[ERROR] Error processing row: {e}", file=sys.stderr)
                    continue

        # Generate summary file
        if results:
            summary_file = output_dir / "summary_all.csv"
            with open(summary_file, 'w', encoding='utf-8-sig', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=results[0].keys())
                writer.writeheader()
                writer.writerows(results)
            print(f"\n[OK] Summary file created: {summary_file}")
            print(f"\nTotal: {len(results)} records processed")

        return len(results)

    except FileNotFoundError:
        print(f"[ERROR] Input file '{input_file}' not found", file=sys.stderr)
        return 0
    except Exception as e:
        print(f"[ERROR] Unexpected error: {e}", file=sys.stderr)
        return 0


def main():
    if len(sys.argv) < 2:
        print("Usage: python calculate.py <input_csv_file>")
        print("\nInput CSV format:")
        print("고객명,나이,성별,키,몸무게,골격근량,체지방량,활동지수")
        print("\nActivity levels:")
        print("1.2   = Sedentary (little or no exercise)")
        print("1.375 = Lightly active (exercise 1-3 days/week)")
        print("1.55  = Moderately active (exercise 3-5 days/week)")
        print("1.725 = Very active (exercise 6-7 days/week)")
        print("1.9   = Extra active (hard exercise daily or physical job)")
        sys.exit(1)

    input_file = sys.argv[1]
    count = process_csv(input_file)

    if count > 0:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
