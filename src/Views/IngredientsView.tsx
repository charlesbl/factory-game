import React from 'react'
import Ingredient from '../Game/Ingredient'

interface IItemsCraftProps {
    ingredients: Ingredient[]
}

const renderItemStack = (ingredient: Ingredient, index: number): JSX.Element => {
    let rateDiv
    return (
        <div key={index} className="item">
            <div>{ingredient.item.name}</div>
            {rateDiv}
        </div>
    )
}

const IngredientsView = (props: IItemsCraftProps): JSX.Element => {
    return (
        <div className="item-list">
            {props.ingredients.map((itemStack, i) => renderItemStack(itemStack, i))}
        </div>
    )
}
export default IngredientsView
