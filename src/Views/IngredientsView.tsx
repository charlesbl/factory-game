import React from 'react';
import Ingredient from '../Game/Ingredient';

interface IItemsCraftProps {
    ingredients: Ingredient[];
    craftDuration?: number;
}

export default class IngredientsView extends React.Component<IItemsCraftProps> {

    renderItemStack(ingredient: Ingredient, index: number) {
        let rateDiv;
        if (this.props.craftDuration) {
            const rate = ingredient.quantityPerSecond / this.props.craftDuration * 1000;
            rateDiv = <div>{rate.toFixed(2)}/s</div>;
        }
        return (
            <div key={index} className="item">
                <div>{this.props.craftDuration ? ingredient.quantityPerSecond : ""} {ingredient.item.name}</div>
                {rateDiv}
            </div>
        );
    }

    render() {
        return (
            <div className="item-list">
                {this.props.ingredients.map((itemStack, i) => this.renderItemStack(itemStack, i))}
            </div>
        );
    }
}