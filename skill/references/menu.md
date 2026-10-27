# Menu and delivery (PLACEHOLDER PRICES)

Generated from `src/catalog.ts` by `pnpm menu:gen`. Do not edit by hand.
These prices are placeholders until the owner confirms the real menu.

Pass the `Item id` column as `item_id` to `quote_order` and `create_order`. Quote prices exactly as listed, in naira.

## Drinks

| Item id | Name | Description | Price |
| --- | --- | --- | --- |
| `zobo-35cl` | Zobo (35cl) | Hibiscus drink with ginger and pineapple | ₦1,000 |
| `zobo-50cl` | Zobo (50cl) | Hibiscus drink with ginger and pineapple | ₦1,800 |
| `kunu-35cl` | Kunu (35cl) | Millet drink, lightly spiced | ₦900 |
| `kunu-50cl` | Kunu (50cl) | Millet drink, lightly spiced | ₦1,600 |
| `tigernut-35cl` | Tigernut (35cl) | Creamy tigernut drink with dates | ₦1,300 |
| `tigernut-50cl` | Tigernut (50cl) | Creamy tigernut drink with dates | ₦2,400 |

## Snacks

| Item id | Name | Description | Price |
| --- | --- | --- | --- |
| `puff-puff-10` | Puff puff (10 pieces) | Fresh fried dough balls | ₦1,500 |
| `small-chops-pack` | Small chops pack | 4 puff puff, 3 samosas, 3 spring rolls, 2 chicken wings | ₦4,500 |

## Delivery areas (Abuja)

Pass the `Area` name as `delivery_area`. A street, estate or landmark inside an area counts as that area: for "Softlife Apartments, Jahi" pass `Jahi`. If you're not sure which area a place is in, ask the customer for the area.

| Area | Also called | Delivery fee |
| --- | --- | --- |
| Wuse | Wuse 2, Wuse II, Zone 1, Zone 2, Zone 3, Zone 4, Zone 5, Zone 6, Zone 7 | ₦1,500 |
| Garki | Garki 2, Garki II, Area 1, Area 2, Area 3, Area 7, Area 8, Area 10, Area 11 | ₦1,500 |
| Central Area | CBD, Central Business District | ₦1,500 |
| Maitama |  | ₦1,500 |
| Jabi |  | ₦1,500 |
| Utako |  | ₦1,500 |
| Wuye |  | ₦1,500 |
| Mabushi |  | ₦1,500 |
| Jahi |  | ₦2,000 |
| Kado |  | ₦2,000 |
| Katampe |  | ₦2,000 |
| Life Camp |  | ₦2,000 |
| Asokoro |  | ₦2,000 |
| Guzape |  | ₦2,000 |
| Durumi |  | ₦2,000 |
| Gudu |  | ₦2,000 |
| Gwarinpa |  | ₦2,500 |
| Apo |  | ₦2,500 |
| Lokogoma |  | ₦2,500 |
| Galadimawa |  | ₦2,500 |
| Karsana |  | ₦3,000 |
| Dawaki |  | ₦3,000 |
| Lugbe |  | ₦3,000 |
| Kubwa |  | ₦3,000 |
| Karu |  | ₦3,000 |

Any other area: tell the customer we don't deliver there yet and offer to pass them to the owner.

Orders of more than 30 of one item are bulk or event orders. Hand them to the owner.
