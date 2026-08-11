import type { Food } from '../types'
import { unitFoods } from './build'

/**
 * South African fast food and restaurant menus.
 *
 * These are best-available reference figures — SA menus differ from the US/UK
 * ones, portions vary by store, and chains change recipes without notice.
 * Treat them as close estimates, and edit any item in the app (Foods → tap a
 * food → Edit) if you have the official number.
 *
 * Rows are per unit: [name, unitName, grams, kcal, P, C, F, fibre, sugar, sodium]
 */

const mcdonalds = unitFoods("McDonald's", 'fastfood', [
  ['Big Mac', 'burger', 219, 493, 26, 41, 25, 3, 8, 907],
  ['Quarter Pounder with Cheese', 'burger', 202, 520, 30, 42, 26, 3, 10, 1110],
  ['Double Quarter Pounder with Cheese', 'burger', 280, 740, 48, 43, 42, 3, 10, 1360],
  ['Cheeseburger', 'burger', 119, 300, 15, 33, 12, 2, 7, 680],
  ['Hamburger', 'burger', 105, 253, 12, 31, 9, 2, 6, 480],
  ['McChicken', 'burger', 158, 400, 14, 39, 21, 2, 5, 560],
  ['Chicken Foldover', 'foldover', 145, 350, 20, 33, 15, 2, 3, 780],
  ['McFeast', 'burger', 220, 490, 25, 43, 25, 3, 9, 900],
  ['Big Tasty', 'burger', 335, 840, 45, 47, 53, 3, 9, 1300],
  ['Filet-O-Fish', 'burger', 142, 330, 15, 38, 13, 2, 5, 560],
  ['Grand Chicken Spicy', 'burger', 230, 550, 28, 47, 28, 3, 6, 1150],
  ['Chicken McNuggets (6)', 'portion', 96, 250, 14, 15, 15, 1, 0, 500],
  ['Chicken McNuggets (9)', 'portion', 144, 375, 21, 23, 22, 1, 0, 750],
  ['Chicken McNuggets (20)', 'portion', 320, 833, 47, 50, 49, 2, 0, 1670],
  ['Small Fries', 'portion', 71, 230, 3, 29, 11, 3, 0, 180],
  ['Medium Fries', 'portion', 102, 337, 4, 43, 16, 4, 0, 260],
  ['Large Fries', 'portion', 134, 444, 5, 56, 21, 5, 0, 350],
  ['Egg McMuffin', 'muffin', 135, 300, 17, 30, 12, 2, 3, 730],
  ['Sausage McMuffin', 'muffin', 111, 400, 15, 29, 25, 2, 2, 780],
  ['Sausage & Egg McMuffin', 'muffin', 163, 480, 21, 30, 31, 2, 2, 860],
  ['Big Breakfast', 'plate', 262, 740, 28, 51, 47, 3, 3, 1500],
  ['Hotcakes with syrup (3)', 'plate', 221, 580, 9, 101, 15, 3, 45, 640],
  ['Hash Brown', 'hash brown', 53, 150, 1, 15, 9, 2, 0, 310],
  ['Apple Pie', 'pie', 77, 240, 2, 32, 11, 2, 13, 130],
  ['McFlurry Oreo (regular)', 'cup', 180, 340, 9, 52, 11, 1, 43, 190],
  ['Soft Serve Cone', 'cone', 90, 150, 4, 24, 4, 0, 20, 60],
  ['Sundae (chocolate)', 'sundae', 150, 330, 8, 53, 9, 1, 45, 150],
  ['Cappuccino (regular)', 'cup', 0, 110, 6, 9, 6, 0, 9, 75],
  ['Coca-Cola (medium)', 'cup', 0, 210, 0, 53, 0, 0, 53, 20],
])

const kfc = unitFoods('KFC', 'fastfood', [
  ['Original Recipe Breast', 'piece', 161, 320, 32, 10, 17, 0, 0, 1080],
  ['Original Recipe Thigh', 'piece', 126, 280, 19, 9, 19, 0, 0, 790],
  ['Original Recipe Drumstick', 'piece', 59, 130, 12, 4, 8, 0, 0, 350],
  ['Original Recipe Wing', 'piece', 47, 130, 10, 4, 8, 0, 0, 380],
  ['Hot & Crispy Breast', 'piece', 170, 390, 33, 14, 23, 1, 0, 1100],
  ['Crispy Strip', 'strip', 47, 110, 11, 6, 5, 0, 0, 350],
  ['Popcorn Chicken (regular)', 'portion', 114, 350, 21, 25, 19, 1, 0, 900],
  ['Hot Wings (6)', 'portion', 165, 470, 30, 22, 29, 1, 0, 1300],
  ['Dunked Wings (6)', 'portion', 180, 520, 32, 32, 29, 1, 8, 1400],
  ['Zinger Burger', 'burger', 210, 460, 26, 44, 20, 3, 6, 1050],
  ['Colonel Burger', 'burger', 215, 470, 22, 47, 22, 3, 7, 1000],
  ['Boxmaster', 'wrap', 290, 640, 33, 60, 30, 4, 5, 1500],
  ['Twister Wrap', 'wrap', 220, 480, 24, 46, 22, 3, 4, 1100],
  ['Zinger Wrap', 'wrap', 200, 440, 22, 43, 20, 3, 4, 980],
  ['Streetwise 2 (2 pieces + small chips)', 'meal', 0, 690, 38, 42, 40, 3, 1, 1400],
  ['Streetwise 3 (3 pieces + regular chips)', 'meal', 0, 920, 52, 47, 55, 3, 1, 1900],
  ['Streetwise 5 (5 pieces)', 'meal', 0, 1150, 84, 33, 76, 2, 0, 3200],
  ['Chips (regular)', 'portion', 100, 290, 4, 38, 14, 3, 0, 400],
  ['Chips (large)', 'portion', 150, 430, 6, 56, 20, 4, 0, 600],
  ['Coleslaw (regular)', 'portion', 100, 150, 1, 13, 11, 2, 10, 200],
  ['Mash & Gravy', 'portion', 140, 130, 3, 20, 4, 1, 1, 500],
  ['Krushers (Oreo, regular)', 'cup', 0, 480, 9, 70, 19, 1, 58, 300],
])

const nandos = unitFoods("Nando's", 'fastfood', [
  ['1/4 Chicken (leg & thigh)', 'portion', 145, 339, 33, 0, 23, 0, 0, 700],
  ['1/4 Chicken (breast & wing)', 'portion', 140, 296, 38, 0, 16, 0, 0, 650],
  ['1/2 Chicken', 'portion', 285, 650, 68, 0, 42, 0, 0, 1350],
  ['Full Chicken', 'chicken', 570, 1300, 136, 0, 84, 0, 0, 2700],
  ['Chicken Breast Fillet (butterfly)', 'fillet', 165, 285, 55, 0, 6, 0, 0, 600],
  ['Chicken Burger', 'burger', 250, 474, 42, 45, 14, 3, 6, 1100],
  ['Chicken Pitta', 'pitta', 230, 430, 38, 43, 11, 3, 4, 950],
  ['Chicken Wrap', 'wrap', 260, 512, 40, 50, 18, 3, 5, 1150],
  ['Espetada', 'skewer', 300, 478, 62, 8, 22, 1, 4, 900],
  ['Chicken Livers (starter)', 'portion', 180, 283, 22, 6, 19, 1, 3, 700],
  ['Chicken Wings (5)', 'portion', 200, 394, 40, 0, 26, 0, 0, 900],
  ['Chips (regular)', 'portion', 120, 346, 4, 46, 16, 4, 0, 380],
  ['Chips (large)', 'portion', 180, 520, 7, 68, 24, 6, 0, 570],
  ['Spicy Rice', 'portion', 200, 292, 6, 58, 4, 2, 2, 600],
  ['Macho Peas', 'portion', 150, 124, 8, 15, 3, 6, 3, 350],
  ['Coleslaw', 'portion', 130, 180, 1, 12, 14, 2, 9, 220],
  ['Corn on the Cob', 'cob', 140, 130, 4, 25, 2, 3, 5, 90],
  ['Garlic Bread', 'portion', 100, 300, 8, 38, 13, 2, 2, 550],
  ['Portuguese Roll', 'roll', 60, 180, 6, 34, 2, 2, 2, 340],
])

const steers = unitFoods('Steers', 'fastfood', [
  ['Original Beef Burger', 'burger', 220, 480, 24, 44, 23, 3, 8, 850],
  ['King Steer Burger', 'burger', 320, 690, 38, 45, 40, 3, 9, 1200],
  ['Prince Burger', 'burger', 160, 380, 18, 40, 17, 2, 7, 700],
  ['Grilled Chicken Burger', 'burger', 230, 420, 30, 42, 14, 3, 7, 900],
  ['Rib Burger', 'burger', 260, 560, 26, 48, 30, 3, 10, 1150],
  ['Cheese Dog', 'hot dog', 190, 420, 16, 38, 23, 2, 6, 1000],
  ['Chips (regular)', 'portion', 120, 340, 4, 44, 16, 4, 0, 380],
  ['Chips (large)', 'portion', 180, 520, 7, 67, 24, 6, 0, 570],
  ['Pork Ribs (300 g)', 'portion', 300, 780, 55, 12, 55, 0, 10, 1400],
  ['Onion Rings (6)', 'portion', 110, 300, 4, 34, 16, 2, 4, 500],
])

const wimpy = unitFoods('Wimpy', 'fastfood', [
  ['Original Burger', 'burger', 210, 450, 22, 42, 22, 3, 8, 820],
  ['Cheese & Bacon Burger', 'burger', 290, 640, 32, 43, 38, 3, 8, 1300],
  ['Big Wimpy', 'burger', 300, 620, 32, 45, 35, 3, 8, 1200],
  ['Breakfast (2 eggs, 2 bacon, toast)', 'plate', 0, 560, 24, 38, 34, 2, 4, 1200],
  ['Ultimate Breakfast', 'plate', 0, 900, 40, 55, 58, 3, 6, 2100],
  ['Chicken Schnitzel & Chips', 'plate', 0, 900, 45, 78, 44, 6, 4, 1600],
  ['Toasted Cheese & Tomato Sandwich', 'sandwich', 180, 450, 18, 42, 24, 3, 5, 900],
  ['Cheese Griller & Chips', 'plate', 0, 780, 26, 60, 48, 5, 4, 1700],
  ['Filter Coffee', 'cup', 0, 5, 0, 1, 0, 0, 0, 5],
])

const burgerKing = unitFoods('Burger King', 'fastfood', [
  ['Whopper', 'burger', 270, 660, 28, 49, 40, 3, 11, 980],
  ['Double Whopper', 'burger', 374, 900, 48, 50, 58, 3, 11, 1200],
  ['Whopper Jr', 'burger', 133, 310, 13, 27, 18, 1, 6, 500],
  ['Chicken Royale', 'burger', 220, 570, 25, 48, 32, 3, 6, 1100],
  ['Big King', 'burger', 250, 630, 33, 44, 37, 2, 9, 1050],
  ['Fries (medium)', 'portion', 116, 380, 4, 50, 17, 4, 0, 500],
  ['Onion Rings (medium)', 'portion', 91, 320, 4, 41, 16, 3, 5, 550],
])

const chickenLicken = unitFoods('Chicken Licken', 'fastfood', [
  ['Hotwings (6)', 'portion', 200, 480, 36, 24, 28, 1, 2, 1300],
  ['Hotwings (2)', 'portion', 67, 160, 12, 8, 9, 0, 1, 430],
  ['Dunked Wings (6)', 'portion', 210, 520, 34, 32, 29, 1, 9, 1400],
  ['Soul Fries (regular)', 'portion', 120, 330, 4, 42, 16, 4, 0, 450],
  ['Rock My Soul Burger', 'burger', 240, 520, 26, 48, 25, 3, 6, 1100],
  ['Big John Burger', 'burger', 280, 600, 30, 52, 30, 3, 7, 1250],
  ['Sloppy Dog', 'hot dog', 190, 420, 18, 42, 20, 2, 5, 1000],
])

const debonairs = unitFoods('Debonairs', 'fastfood', [
  ['Triple-Decker Something Meaty (slice)', 'slice', 105, 247, 12, 25, 11, 2, 3, 600],
  ['Triple-Decker Something Meaty (medium, whole)', 'pizza', 840, 1976, 96, 200, 88, 12, 24, 4800],
  ['Something Meaty (slice)', 'slice', 100, 242, 12, 26, 10, 2, 3, 560],
  ['Real Deal Pizza (slice)', 'slice', 90, 212, 9, 27, 7, 2, 3, 480],
  ['Chicken Tikka (slice)', 'slice', 95, 228, 12, 27, 8, 2, 3, 520],
  ['Margherita (slice)', 'slice', 85, 190, 8, 26, 6, 2, 3, 430],
  ['Cheese Burst crust (slice)', 'slice', 115, 282, 13, 28, 14, 2, 3, 680],
])

const romans = unitFoods("Roman's Pizza", 'fastfood', [
  ['Medium Pizza (slice)', 'slice', 85, 200, 9, 25, 7, 2, 3, 450],
  ['Large Pizza (slice)', 'slice', 110, 258, 11, 32, 9, 2, 3, 580],
  ['Medium Pizza (whole, 8 slices)', 'pizza', 680, 1600, 72, 200, 56, 16, 24, 3600],
])

const spur = unitFoods('Spur', 'fastfood', [
  ['Beef Burger', 'burger', 280, 620, 34, 45, 33, 3, 9, 1100],
  ['Cheddamelt Steak (200 g)', 'plate', 0, 750, 55, 20, 50, 2, 6, 1400],
  ['Chicken Schnitzel', 'plate', 0, 700, 45, 48, 36, 3, 4, 1300],
  ['Full Rack Ribs', 'portion', 0, 1100, 70, 30, 78, 1, 24, 2200],
  ['Crispy Chicken Strips (5)', 'portion', 200, 480, 32, 30, 25, 2, 2, 1100],
  ['Chips (regular)', 'portion', 130, 380, 5, 48, 18, 4, 0, 420],
  ['Onion Rings', 'portion', 110, 320, 4, 36, 17, 3, 5, 520],
])

const seafood = unitFoods('Fish & seafood takeaway', 'fastfood', [
  ['Hake & Chips (Fishaways)', 'meal', 0, 780, 38, 70, 38, 6, 2, 1400],
  ['Hake & Chips (Ocean Basket)', 'meal', 0, 820, 42, 72, 40, 6, 2, 1500],
  ['Calamari (Ocean Basket)', 'portion', 200, 520, 40, 30, 26, 2, 2, 1100],
  ['Grilled Line Fish (Ocean Basket)', 'portion', 200, 320, 42, 2, 16, 0, 1, 700],
])

const cafes = unitFoods('Cafés & coffee', 'fastfood', [
  ['Cappuccino (regular, vida e caffè)', 'cup', 0, 130, 7, 10, 7, 0, 10, 90],
  ['Flat White (regular)', 'cup', 0, 150, 8, 11, 8, 0, 11, 100],
  ['Americano (black)', 'cup', 0, 5, 0, 1, 0, 0, 0, 5],
  ['Croissant', 'croissant', 70, 280, 6, 30, 15, 2, 5, 400],
  ['Muffin (Mugg & Bean)', 'muffin', 150, 550, 8, 70, 27, 2, 38, 500],
  ['Chicken Wrap (Kauai)', 'wrap', 260, 420, 32, 40, 13, 5, 4, 800],
  ['Smoothie (Kauai, regular)', 'cup', 0, 280, 6, 55, 3, 4, 45, 60],
])

export const FAST_FOODS: Food[] = [
  ...mcdonalds,
  ...kfc,
  ...nandos,
  ...steers,
  ...wimpy,
  ...burgerKing,
  ...chickenLicken,
  ...debonairs,
  ...romans,
  ...spur,
  ...seafood,
  ...cafes,
]

/** Chains shown as browsable tiles on the Foods screen. */
export const FAST_FOOD_BRANDS = [
  "McDonald's",
  'KFC',
  "Nando's",
  'Steers',
  'Wimpy',
  'Burger King',
  'Chicken Licken',
  'Debonairs',
  "Roman's Pizza",
  'Spur',
  'Fish & seafood takeaway',
  'Cafés & coffee',
]
