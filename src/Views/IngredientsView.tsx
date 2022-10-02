import React from 'react'
import Ingredient from '../Game/Ingredient'

interface IItemsCraftProps {
    ingredients: Ingredient[]
}

const IngredientsView = (props: IItemsCraftProps): JSX.Element => {
    return (
        <div className="item-list">
            {props.ingredients.map((ingredient, i) => {
                return <div key={i} className="item">
                    <div>{ingredient.item.name}</div>
                    <div>{ingredient.quantityPerSecond.toFixed(2)}/s</div>
                </div>
            })}
        </div>
    )
}
export default IngredientsView
