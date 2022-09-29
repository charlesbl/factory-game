import React from 'react'
import Ingredient from '../Game/Ingredient'

interface IItemsCraftProps {
    ingredients: Ingredient[]
}

export default class IngredientsView extends React.Component<IItemsCraftProps> {
    renderItemStack (ingredient: Ingredient, index: number): JSX.Element {
        let rateDiv
        return (
            <div key={index} className="item">
                <div>{ingredient.item.name}</div>
                {rateDiv}
            </div>
        )
    }

    render (): JSX.Element {
        return (
            <div className="item-list">
                {this.props.ingredients.map((itemStack, i) => this.renderItemStack(itemStack, i))}
            </div>
        )
    }
}
